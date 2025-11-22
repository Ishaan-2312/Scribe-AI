require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "tmp/" });


const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });


const sessionTranscripts = {};
const sessionSockets = {}; 

io.on('connection', (socket) => {
  
  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    if (!sessionSockets[sessionId]) sessionSockets[sessionId] = [];
    sessionSockets[sessionId].push(socket.id);
    console.log(`[Socket.io] Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('disconnecting', () => {
    Object.keys(socket.rooms).forEach((room) => {
      if (sessionSockets[room]) {
        sessionSockets[room] = sessionSockets[room].filter((id) => id !== socket.id);
        if (sessionSockets[room].length === 0) delete sessionSockets[room];
      }
    });
  });
});


app.post('/upload-chunk', upload.single('audio'), async (req, res) => {
  let webmPath, wavPath;
  try {
    const { sessionId } = req.body;
    webmPath = req.file.path;
    wavPath = `${webmPath}.wav`;

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
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wavBuffer.toString("base64"),
              },
            },
            { text: "Transcribe audio to text." },
          ],
        },
      ],
    });

    let transcript = response.text || "";
    if (!transcript && response.candidates) {
      transcript = response.candidates[0]?.content?.parts?.[0]?.text || "";
    }

    if (sessionId) {
      if (!sessionTranscripts[sessionId]) sessionTranscripts[sessionId] = [];
      sessionTranscripts[sessionId].push(transcript);
    }

  
    io.to(sessionId).emit('transcript_update', {
      sessionId,
      chunk: transcript,
      chunkIndex: (sessionTranscripts[sessionId] || []).length - 1,
    });
    io.to(sessionId).emit('session_state', {
      sessionId,
      state: "recording",
    });
    console.log(`[Server] Chunk transcribed and sent via socket for session ${sessionId}`);

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


app.post('/summarize', express.json(), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const transcriptArr = sessionTranscripts[sessionId] || [];
    if (transcriptArr.length === 0) {
      return res.status(400).json({ summary: "No transcript available for this session." });
    }
    const fullTranscript = transcriptArr.join(" ");

    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
You are an expert multilingual transcript summarizer.
Summarize the following audio transcript. Produce concise bullet points covering the most important ideas, events, arguments, steps, explanations, or actions -- whatever is relevant for this context.
- Do NOT assume this is a formal meeting; handle voice notes, podcasts, interviews, lectures, chats, etc.
- If text is in more than one language (e.g. Hindi + English + Hinglish), preserve language-mixing in the summary too.
- If code, commands, or technical instructions are present, summarize their essence.
- Provide 1-3 lines at the top with the topic or main gist (if you can infer).
- If there are clear next steps, tasks, or conclusions, highlight them as separate bullet points.
Here is the full transcript, possibly in multiple languages:
${fullTranscript}
              `
            }
          ]
        }
      ]
    });

    let summary = response.text || "";
    if (!summary && response.candidates) {
      summary = response.candidates[0]?.content?.parts?.[0]?.text || "";
    }

    
    io.to(sessionId).emit('summary_ready', {
      sessionId,
      summary
    });
    io.to(sessionId).emit('session_state', {
      sessionId,
      state: "completed"
    });
    console.log(`[Server] Summary emitted via socket for session ${sessionId}`);
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

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
