# ScribeAI — AI-Powered Audio Scribing & Meeting Transcription App

**Full-stack app to record, transcribe, summarize and export audio from mic or meeting tabs (Google Meet/Zoom) in real-time using Next.js, Gemini API, and Postgres.**

---

## 🗂️ Project Structure

ScribeAI/
├─ scribe_backend/
│ ├─ index.js # Express + Socket.io + Gemini integration
│ ├─ package.json
│ ├─ .env.example
│ └─ tmp/
├─ scribe_frontend/
│ ├─ app/ or src/ # Next.js (App Router + TS)
│ ├─ prisma/ # (Prisma ready for future db storage)
│ ├─ public/
│ ├─ .env.example
│ └─ package.json
├─ .gitignore # Ignores .env, node_modules, .next, /tmp, etc.
└─ README.md



---

## 🚀 Features (As Implemented)

- **User authentication** (Better Auth, Next.js)
- **Live chunked audio recording** (mic or tab via getDisplayMedia, fallback logic)
- **Real-time transcription**: Each chunk streamed to backend, transcribed with Gemini API
- **Socket.io**: Instant updates for transcript and summary
- **Fallback**: If tab recording fails, reverts to mic — shows UI reason
- **AI summary generation**: After stop, Gemini summarizes conversation (multi-lingual aware)
- **Pause/Resume/Stop**: Seamless state changes, all UI reacts
- **Dark/light mode** UI
- **Code quality**: ESLint/Prettier, modular code, root .gitignore
- **Future ready**: Postgres/Prisma wiring started (db storage planned)

---

## ✅ How to Run

### 1. **Clone & Environment**

git clone https://github.com/Ishaan-2312/Scribe-AI

cd ScribeAI/


Fill out **scribe_backend/.env.example** and **scribe_frontend/.env.example**, then copy to `.env` and set:
- GEMINI_API_KEY
- (If using Postgres/Prisma: DATABASE_URL)

### 2. **Start Backend**

cd scribe_backend

npm install

npm start



### 3. **Start Frontend**


cd ../scribe_frontend

npm install

npm run dev



### 4. **(Postgres DB for full session storage)**



---

## 🏃 Usage Walkthrough

- **Sign up or log in.**
- Pick **mic** or **tab** as source. Start recording.
- Transcript appears chunk-by-chunk as you speak/share tab.  
  - If tab fails (no audio/permission), mic fallback is auto-handled and banner shown.
- Pause/resume/stop as needed.
- After stop, click “Generate Summary”. AI summary appears when done.
- Download/copy transcript/summary (history/export planned).

---

## 🔗 Architecture (Mermaid Diagram)

flowchart LR
FE[Frontend Dashboard] -- MediaRecorder Chunk --> A[Express/Node.js Backend]
FE -- Socket.io Connect --> B(Socket.io Server)
A -- Gemini API (transcription) --> C[Gemini]
A -- emits transcript_update --> FE
A -- emits summary_ready --> FE





---

## ⚡ Technology/Design Choices Table

| Approach        | Latency | Streaming | Reliability | Complexity | Applied?            |
|-----------------|---------|-----------|-------------|------------|---------------------|
| HTTP Chunks     | Med     | Emulated  | High        | Low        | ✔️ (Implemented)    |
| True WebSockets | Low     | True      | High        | Medium     | ✔️ (Socket.io events)|
| WebRTC          | Lowest  | True      | High        | High       | ❌ (Not needed here) |

**Why:** HTTP + Socket.io covers “real-time” updates and chunk upload without the complexity of raw WebRTC (overkill for scribing/notes).

---

## 📈 1hr+ Scalability — (Required Analysis)

ScribeAI handles large sessions (hour-long meetings) by chunking audio in the browser every 20 seconds and streaming it to the backend for immediate, independent transcription. This keeps browser memory low and mitigates risks of buffer overflow or network drops. Backend only ever needs to deal with and store a small chunk at a time, reducing the possibility of memory leaks or timeouts.

Socket.io ensures the user receives transcript/summary updates as soon as they are ready, reducing UI latency. Should a device disconnect, only the most recent chunk is impacted (auto-retry or session resume is planned). DB storage (Prisma/Postgres) allows eventual paging, search, and export even for vast session histories. This approach is robust under high concurrency because chunked jobs per session/user can be processed and stored independently, and scaling is as simple as adding more worker backends or database power.

---

## ℹ️ What’s Implemented vs. What’s Outstanding

### Implemented
- [x] Chunked mic/tab audio capture, robust fallback, MediaRecorder chunk streaming
- [x] Socket.io live updates: transcript, summary, state
- [x] AI summary (Gemini), generic multi-language prompt
- [x] Resilient UI: pause/resume/stop, prompt, dark mode
- [x] Authentication (Better Auth), code style, .gitignore
- [x] Ready for Postgres/Prisma extension (frontend + backend)

### Outstanding / Tradeoffs
- [ ] **Persistent DB session storage:**  
  - Only in-memory transcript right now (planned: Prisma backend connection for full historic session storage, export/download).
- [ ] **Session history/download UI:**  
  - No page yet, planned as /sessions route listing transcripts per user.
- [ ] **Tab close/reconnect recover:**  
  - No “auto-resume from last chunk” yet (would use sessionId and DB).
- [ ] **Speaker diarization:**  
  - Only what Gemini natively infers—prompt-level, not audio-level.
- [ ] **WebRTC streaming:**  
  - Out of scope for note-taking/transcription; would only add complexity.

**Rationale:**  
Focus is on seamless real-time UX, fallback, and AI integration. DB/state/history is planned, and sockets are in place for “future readiness.”

---

## 📝 How to Test

1. Sign up, log in at `localhost:3000`
2. Try mic and tab recording modes (simulate tab failures to watch fallback).
3. Watch transcript/summary appear in real time.
4. Try pausing/resuming and stopping with large audio.
5. (Reviewers: observe README, code docs, error handling, UX.)

---

## 🎬 Demo Video

Watch the full walkthrough/demo of ScribeAI running on a local system (all major features shown):

https://youtu.be/La6EMg7BXFw

** The song in the video has been muted for Copyright Actions and youtube guidelines

---


## 👥 Credits, Contact, & Attribution

Built by:  
- [Ishaan Bansal]

Tech/infra: Next.js, Node.js, Prisma, Socket.io, Google Gemini, Tailwind, Postgres (Docker)

Assignment Spec by AttackCapital

---

**For questions or follow-up:**  
`ishaan.bansal2312@gmail.com`

---

## 🏁 Next Up (Planned/Future Work)

- Integrate real DB session chunk storage and retrieval
- Build session history + export page
- Advanced edge handling (resume, multi-user collab)
- Switch from in-memory-only to scalable cloud DB

---





