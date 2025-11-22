"use client";

import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { useEffect, useState, useRef } from "react";
import { io as socketIOClient, Socket } from "socket.io-client";

const CHUNK_MS = 20000;

const generateSessionId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // THEME: 'dark' or 'light'
  const [theme, setTheme] = useState("dark");
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  const [inputType, setInputType] = useState<"mic" | "tab">("mic");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [summarizing, setSummarizing] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [tabFallbackReason, setTabFallbackReason] = useState(""); // Fallback info
  const [socket, setSocket] = useState<Socket | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const endedRef = useRef<boolean>(false);
  const recordingRef = useRef<boolean>(false);
  const pauseRef = useRef<boolean>(false);

 
  const navbarClass = `w-full flex items-center justify-between px-8 py-3 border-b ${
    theme === "dark"
      ? "bg-gray-900 border-gray-800 text-white"
      : "bg-white border-gray-300 text-gray-900"
  }`;
  const panelClass =
    theme === "dark"
      ? "bg-gray-800 text-white border border-gray-700"
      : "bg-white text-gray-900 border border-gray-300 shadow-md";
  const accentBanner =
    theme === "dark"
      ? "bg-orange-700 text-white border border-orange-900"
      : "bg-yellow-400 text-gray-900 border border-yellow-600";
  const pageBg = theme === "dark" ? "bg-black" : "bg-gray-100";
  const headingClass =
    theme === "dark"
      ? "font-bold text-lg text-white mb-1"
      : "font-bold text-lg text-gray-900 mb-1";

  -
  useEffect(() => {
    const s = socketIOClient("http://localhost:3001");
    setSocket(s);

    
    if (sessionId) {
      s.emit('join_session', sessionId);
    }

    s.on('transcript_update', ({ sessionId: sid, chunk }) => {
      if (!sessionId || sid !== sessionId) return;
      setLiveTranscript((prev) => [...prev, chunk || "[No transcript returned (socket)]"]);
      setProgress("Transcription received (Socket event)");
   
      setError("");
    });
    s.on('summary_ready', ({ sessionId: sid, summary: socketSummary }) => {
      if (!sessionId || sid !== sessionId) return;
      setSummary(socketSummary || "No summary returned (Socket event)");
      setProgress("");
      setSummarizing(false);
    });
    s.on('session_error', ({ error }) => {
      setError("Socket error: " + error);
      setProgress("");
    });
    s.on('session_state', ({ state }) => {
      if (state === "recording") setProgress("Recording...");
      if (state === "completed") setProgress("Session completed!");
      if (state === "paused") setProgress("Paused...");
      if (state === "processing") setProgress("Processing...");
    });

    return () => {
      s.disconnect();
    };
    
  }, [sessionId]);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.push("/sign-in");
    }
    return () => {
      endedRef.current = true;
      recordingRef.current = false;
      pauseRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isPending, session, router]);

  const uploadChunkToBackend = async (blob: Blob, sessId: string, retry = 0) => {
    setProgress("Sending for transcription...");
    if (blob.size < 2048) {
      setProgress("Skipped empty audio chunk.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("audio", blob, "chunk.webm");
      formData.append("sessionId", sessId);

      const res = await fetch("http://localhost:3001/upload-chunk", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Network error (status " + res.status + ")");
      const data = await res.json();
      
      setLiveTranscript((prev) => [...prev, data.transcript || "[No transcript returned (HTTP)]"]);
      setProgress("Transcription received (HTTP)");
    } catch (err: any) {
      if (retry < 2) {
        setProgress(`Retrying upload... (${retry + 1})`);
        setTimeout(() => uploadChunkToBackend(blob, sessId, retry + 1), 1000);
        return;
      }
      setLiveTranscript((prev) => [...prev, "[Chunk Transcription Failed]"]);
      setError("Chunk upload/API error: " + (err?.message || err));
      setProgress("");
    }
  };

  const safeGetUserMedia = async () => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError("Microphone access denied. Please allow mic usage.");
      throw err;
    }
  };

  
  const recordChunk = async (stream: MediaStream, sessId: string) => {
    if (!recordingRef.current || endedRef.current) return;
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    if (pauseRef.current) {
      setProgress("Recording paused.");
      return;
    }
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorderRef.current = recorder;
      setMediaRecorder(recorder);
    } catch (e) {
      setError("Mic recorder initialization failed.");
      setRecording(false);
      recordingRef.current = false;
      setProgress("");
      return;
    }
    recorder.ondataavailable = async (event) => {
      if (endedRef.current || pauseRef.current) return;
      if (event.data.size > 0) {
        await uploadChunkToBackend(event.data, sessId);
      }
      if (recordingRef.current && !endedRef.current && !pauseRef.current) {
        setTimeout(() => recordChunk(stream, sessId), 0);
      }
    };
    recorder.onerror = (e) => {
      setRecording(false);
      recordingRef.current = false;
      setError("MediaRecorder error: " + e.error.name);
      setProgress("");
    };
    try {
      recorder.start();
      setError("");
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, CHUNK_MS);
    } catch (e: any) {
      setError("Failed to start MediaRecorder: " + (e?.message || e));
      setRecording(false);
      recordingRef.current = false;
      setProgress("");
    }
  };

  
  const startRecording = async (forceMic = false) => {
    setRecording(true);
    setPaused(false);
    recordingRef.current = true;
    pauseRef.current = false;
    setLiveTranscript([]);
    setSummary("");
    setError("");
    setProgress("");
    setTabFallbackReason("");
    endedRef.current = false;
    const sessId = generateSessionId();
    setSessionId(sessId);

    let stream: MediaStream;
    if (forceMic || inputType === "mic") {
      try {
        stream = await safeGetUserMedia();
        if (forceMic) setTabFallbackReason("Tab audio could not be recorded, automatically switched to microphone.");
        streamRef.current = stream;
        await recordChunk(stream, sessId);
      } catch {
        
      }
      return;
    }

   
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      const hasAudio = stream.getAudioTracks && stream.getAudioTracks().length > 0;
      if (!hasAudio) {
        setTabFallbackReason("No tab audio detected, switched to microphone.");
        stream.getTracks()?.forEach((t) => t.stop());
        await startRecording(true);
        return;
      }
      try {
        const testRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        let started = false;
        testRecorder.onstart = () => {
          started = true;
          testRecorder.stop();
        };
        testRecorder.onstop = async () => {
          if (started) {
            streamRef.current = stream;
            await recordChunk(stream, sessId);
          } else {
            setTabFallbackReason("Failed to start recording tab audio, switched to microphone.");
            stream.getTracks()?.forEach((t) => t.stop());
            await startRecording(true);
          }
        };
        testRecorder.onerror = async () => {
          setTabFallbackReason("Tab recording error, switched to microphone.");
          stream.getTracks()?.forEach((t) => t.stop());
          await startRecording(true);
        };
        testRecorder.start();
        setTimeout(() => {
          if (testRecorder.state === "recording") testRecorder.stop();
        }, 200);
      } catch (e) {
        setTabFallbackReason("Tab MediaRecorder failed, switched to microphone.");
        stream.getTracks()?.forEach((t) => t.stop());
        await startRecording(true);
        return;
      }
    } catch (e) {
      setTabFallbackReason("Tab media access denied or failed, switched to microphone.");
      await startRecording(true);
    }
  };

  const stopRecording = () => {
    endedRef.current = true;
    setRecording(false);
    setPaused(false);
    recordingRef.current = false;
    pauseRef.current = false;
    setProgress("");
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch (e) {}
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    } catch (e) {}
  };

  const pauseRecording = () => {
    setPaused(true);
    pauseRef.current = true;
    setProgress("Recording paused.");
    try {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.pause();
      }
    } catch (e) {}
  };

  const resumeRecording = () => {
    setPaused(false);
    pauseRef.current = false;
    setProgress("Recording resumed.");
    try {
      if (mediaRecorder && mediaRecorder.state === "paused") {
        mediaRecorder.resume();
      }
    } catch (e) {}
    if (streamRef.current && recordingRef.current && !endedRef.current) {
      recordChunk(streamRef.current, sessionId);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setProgress("Requesting summary...");
    setError("");
    try {
      const res = await fetch("http://localhost:3001/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      setSummary(data.summary || "No summary returned (HTTP)");
      setProgress("");
    } catch (err: any) {
      setSummary("Summarization failed.");
      setProgress("");
      setError("Summary API/network failed: " + String(err));
    }
    setSummarizing(false);
  };

  if (isPending)
    return <p className="text-center mt-8 text-white">Loading...</p>;
  if (!session?.user)
    return <p className="text-center mt-8 text-white">Redirecting...</p>;

  const { user } = session;
  const canSummarize = liveTranscript.length > 0 && (paused || !recording || endedRef.current);

  return (
    <div className={`min-h-screen ${pageBg} transition-all`}>
      {/* Navbar */}
      <nav className={navbarClass}>
        <div className="text-xl font-bold">ScribeAI</div>
        <div className="flex gap-2 items-center">
          <button
            onClick={toggleTheme}
            className="ml-4 px-3 py-1 rounded text-sm font-semibold border border-gray-400 dark:border-gray-600 hover:opacity-80"
          >
            {theme === "dark" ? "Light Theme" : "Dark Theme"}
          </button>
          <button
            onClick={() => signOut()}
            className={`${theme === "dark"
              ? "bg-white text-black"
              : "bg-black text-white"} font-medium rounded-md px-4 py-2 hover:opacity-80`}
          >
            Sign Out
          </button>
        </div>
      </nav>
      <main className="max-w-3xl flex flex-col mx-auto p-6 space-y-4">
        {}
        {tabFallbackReason && (
          <div className={`${accentBanner} rounded px-3 py-2 my-2 text-sm font-semibold`}>
            {tabFallbackReason}
          </div>
        )}
        <div className="flex flex-col items-start mt-4">
          <p className={headingClass}>Welcome, {user.name || "User"}!</p>
        </div>
        {}
        <div className="flex items-center gap-4 mt-4">
          <label>
            <input
              type="radio"
              name="audioSource"
              checked={inputType === "mic"}
              onChange={() => setInputType("mic")}
              disabled={recording}
            />
            <span className={`ml-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Mic</span>
          </label>
          <label>
            <input
              type="radio"
              name="audioSource"
              checked={inputType === "tab"}
              onChange={() => setInputType("tab")}
              disabled={recording}
            />
            <span className={`ml-1 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>Meeting/Tab Audio</span>
          </label>
        </div>
        <div className="space-x-2 mt-6">
          {!recording ? (
            <button
              onClick={() => startRecording()}
              className="bg-green-600 px-4 py-2 rounded hover:bg-green-700 font-semibold"
            >
              Start Recording
            </button>
          ) : (
            <>
              <button
                onClick={stopRecording}
                className="bg-red-600 px-4 py-2 rounded hover:bg-red-700 font-semibold"
              >
                Stop Recording
              </button>
              <button
                onClick={paused ? resumeRecording : pauseRecording}
                className={"bg-blue-600 px-4 py-2 rounded hover:bg-blue-700 ml-2 font-semibold"}
                disabled={!recording}
              >
                {paused ? "Resume" : "Pause"}
              </button>
            </>
          )}
        </div>
        {progress && <p className="text-blue-600 font-semibold">{progress}</p>}
        {error && <p className="text-red-500 font-semibold">{error}</p>}
        {recording && (
          <p className="text-green-600 font-semibold">Recording ON...</p>
        )}
        {inputType === "tab" && !recording && (
          <div className="bg-blue-100 text-blue-900 border border-blue-300 rounded p-2 mt-2 text-sm">
            Tip: If tab audio cannot be captured, open your meeting/video in a separate window and use the mic option for recording.
          </div>
        )}
        <div className="flex flex-col md:flex-row w-full gap-4 mt-6">
          <div className="flex-1">
            <h2 className={headingClass}>Live Transcript:</h2>
            <div className={`${panelClass} rounded p-2 min-h-[128px] text-sm whitespace-pre-wrap`}>
              {liveTranscript.length === 0 ? (
                <span className="text-gray-400">
                  – Live Transcript  –
                </span>
              ) : (
                liveTranscript.join(" ")
              )}
            </div>
          </div>
          {}
          <div className="flex-1">
            <h2 className={headingClass}>Summary:</h2>
            <div className={`${panelClass} rounded p-2 min-h-[128px] text-sm whitespace-pre-wrap`}>
              {summary ? (
                summary
              ) : (
                <span className="text-gray-400">
                  – Summary will appear after Summarization –
                </span>
              )}
            </div>
          </div>
        </div>
        {}
        {canSummarize && (
          <button
            className="bg-yellow-500 px-4 py-2 rounded hover:bg-yellow-600 mt-6 text-black font-semibold"
            onClick={handleSummarize}
            disabled={summarizing}
          >
            {summarizing ? "Summarizing..." : "Generate Summary"}
          </button>
        )}
      </main>
    </div>
  );
}
