require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
const upload = multer({ dest: "tmp/" });

// --- PG Setup ---
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'scribe_backend', // your db name
  password: process.env.PGPASSWORD ,
  port: 5432,
});

// --- Gemini ---
const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

io.on('connection', (socket) => {
  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    console.log(`[Socket.io] Socket ${socket.id} joined session ${sessionId}`);
  });
});

// ---- UPLOAD CHUNK ----
app.post('/upload-chunk', upload.single('audio'), async (req, res) => {
  let webmPath, wavPath;
  try {
    const { sessionId } = req.body;
    webmPath = req.file.path;
    wavPath = `${webmPath}.wav`;

    // FFmpeg conversion
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    await new Promise((resolve, reject) => {
      ffmpeg(webmPath)
        .audioChannels(1)
        .audioFrequency(16000)
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(wavPath);
    });

    const wavBuffer = fs.readFileSync(wavPath);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: wavBuffer.toString("base64") }},
            { text: "Transcribe audio to text." },
          ],
        },
      ],
    });
    let transcript = response.text || "";
    if (!transcript && response.candidates) {
      transcript = response.candidates[0]?.content?.parts?.[0]?.text || "";
    }

    // DB upsert session
    await pool.query(
      'INSERT INTO session (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [sessionId]
    );
    // Find next chunk index
    const { rows } = await pool.query(
      'SELECT COUNT(*) FROM transcript_chunk WHERE session_id=$1',
      [sessionId]
    );
    const chunkIndex = Number(rows[0].count);

    // Save chunk
    await pool.query(
      'INSERT INTO transcript_chunk (session_id, chunk_index, text) VALUES ($1, $2, $3)',
      [sessionId, chunkIndex, transcript]
    );

    io.to(sessionId).emit('transcript_update', { sessionId, chunk: transcript, chunkIndex });
    io.to(sessionId).emit('session_state', { sessionId, state: "recording" });
    console.log(`[Server] Chunk ${chunkIndex} saved/transcribed for session ${sessionId}`);
    res.json({ transcript });

  } catch (err) {
    console.error('[upload-chunk] error:', err);
    if (req.body?.sessionId) {
      io.to(req.body.sessionId).emit('session_error', {
        sessionId: req.body.sessionId,
        error: String(err),
      });
    }
    res.status(500).json({ error: "Failed to process/transcribe chunk." });
  } finally {
    if (webmPath) try { fs.unlinkSync(webmPath); } catch {}
    if (wavPath) try { fs.unlinkSync(wavPath); } catch {}
  }
});

// ---- SUMMARIZE ----
app.post('/summarize', express.json(), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const { rows: chunks } = await pool.query(
      'SELECT text FROM transcript_chunk WHERE session_id=$1 ORDER BY chunk_index ASC',
      [sessionId]
    );
    if (!chunks.length) {
      return res.status(400).json({ summary: "No transcript available for this session." });
    }
    const fullTranscript = chunks.map((c) => c.text).join(" ");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: `
You are an expert multilingual transcript summarizer.
Summarize the following audio transcript. Produce concise bullet points covering the most important ideas, events, arguments, steps, explanations, or actions -- whatever is relevant for this context.
- Do NOT assume this is a formal meeting; handle voice notes, podcasts, interviews, lectures, chats, etc.
- If text is in more than one language (e.g. Hindi + English + Hinglish), preserve language-mixing in the summary too.
- If code, commands, or technical instructions are present, summarize their essence.
- Provide 1-3 lines at the top with the topic or main gist (if you can infer).
- If there are clear next steps, tasks, or conclusions, highlight them as separate bullet points.
Here is the full transcript, possibly in multiple languages:
${fullTranscript}
              `}
          ]
        }
      ]
    });

    let summary = response.text || "";
    if (!summary && response.candidates) {
      summary = response.candidates[0]?.content?.parts?.[0]?.text || "";
    }

    // Save/update summary
    await pool.query(
      `INSERT INTO summary (session_id, summary) VALUES ($1, $2)
       ON CONFLICT (session_id) DO UPDATE SET summary = $2`,
      [sessionId, summary]
    );
    await pool.query(
      'UPDATE session SET ended_at=$1 WHERE id=$2',
      [new Date(), sessionId]
    );

    io.to(sessionId).emit('summary_ready', { sessionId, summary });
    io.to(sessionId).emit('session_state', { sessionId, state: "completed" });

    console.log(`[Server] Summary saved/emitted for session ${sessionId}`);
    res.json({ summary });

  } catch (err) {
    console.error('[summarize] error:', err);
    if (req.body?.sessionId) {
      io.to(req.body.sessionId).emit('session_error', {
        sessionId: req.body.sessionId,
        error: String(err),
      });
    }
    res.status(500).json({ error: "Failed to summarize transcript." });
  }
});

// ---- GET ALL SESSIONS (dashboard history) ----
app.get('/sessions', async (req, res) => {
  try {
    const { rows: sessions } = await pool.query(
      `SELECT s.*, su.summary,
         (SELECT json_agg(json_build_object('chunk_index', c.chunk_index, 'text', c.text))
            FROM transcript_chunk c WHERE c.session_id=s.id) AS chunks
         FROM session s LEFT JOIN summary su ON su.session_id = s.id
         ORDER BY s.created_at DESC`
    );
    res.json(sessions);
  } catch (err) {
    console.error('[sessions] error:', err);
    res.status(500).json({ error: "Failed to fetch sessions." });
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
