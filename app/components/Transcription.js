"use client";

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  ChevronDown,
  Settings,
  Sliders,
  Clipboard,
  Download,
  RefreshCw,
  Activity,
} from "react-feather";
import React from "react";

export default function Transcription({ parentDarkMode }) {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [confirmedText, setConfirmedText] = useState("");
  const [tentativeText, setTentativeText] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [userPrompt, setUserPrompt] = useState("");
  const [microphoneAllowed, setMicrophoneAllowed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const transcriptContainerRef = useRef(null);
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const correctionTimeoutRef = useRef(null);
  const wordBuffer = useRef([]);
  const lastCorrectionTime = useRef(Date.now());
  const isProcessing = useRef(false);
  const transcriptsRef = useRef([]);
  const confirmedTextRef = useRef("");

  // Sync dark mode with parent
  useEffect(() => {
    if (parentDarkMode !== undefined) {
      setDarkMode(parentDarkMode);
    }
  }, [parentDarkMode]);

  // Add a useEffect to keep the refs in sync with state
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    confirmedTextRef.current = confirmedText;
  }, [confirmedText]);

  // Scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop =
        transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts, confirmedText, tentativeText]);

  async function requestMicrophonePermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicrophoneAllowed(true);
    } catch (error) {
      console.error("Microphone permission denied:", error);
    }
  }

  function copyTranscriptsToClipboard() {
    const text = transcripts.map((t) => t.text).join(" ");
    navigator.clipboard.writeText(text);
  }

  function downloadTranscriptsAsText() {
    const text = transcripts.map((t) => t.text).join(" ");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function startTranscriptionSession() {
    if (isActivating) return;
    setIsActivating(true);

    try {
      // Get a session token for OpenAI Realtime Transcription API
      const tokenResponse = await fetch(
        `/api/transcription-token?language=${selectedLanguage}&prompt=${encodeURIComponent(
          userPrompt
        )}`
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Failed to get transcription token:", errorText);
        throw new Error(`Failed to get transcription token: ${errorText}`);
      }

      const data = await tokenResponse.json();
      console.log("Received session data:", data);

      // Check if session data exists
      if (!data.id) {
        throw new Error("No session ID in response: " + JSON.stringify(data));
      }

      // Check if client_secret exists
      if (!data.client_secret) {
        throw new Error(
          "No client_secret in response: " + JSON.stringify(data)
        );
      }

      // Use the client_secret.value as the ephemeral key
      const EPHEMERAL_KEY = data.client_secret.value;

      // Store the session data
      const SESSION_ID = data.id;
      const SESSION_OBJECT = data;

      // Create a peer connection with optimized configuration
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
        iceTransportPolicy: "all",
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        sdpSemantics: "unified-plan",
      });
      peerConnection.current = pc;

      // Add local audio track for microphone input with optimized settings
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Optimize for speech
          channelCount: 1, // Mono audio
          sampleSize: 16, // 16-bit samples
        },
      });
      pc.addTrack(ms.getTracks()[0]);

      // Set up data channel for receiving transcription events
      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;

      // Setup event handlers for the data channel
      dc.addEventListener("open", () => {
        console.log("Data channel opened");
        setIsSessionActive(true);
        setIsActivating(false);
        setTranscripts([]);
        setConfirmedText("");
        setTentativeText("");
        wordBuffer.current = [];
        lastCorrectionTime.current = Date.now();
        isProcessing.current = false;
      });

      dc.addEventListener("message", (e) => {
        console.log("Data channel message received");
        const event = JSON.parse(e.data);
        handleTranscriptionEvent(event);
      });

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      console.log("Sending SDP offer to API");
      const sdpResponse = await fetch(`${baseUrl}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error("SDP response error:", errorText);
        throw new Error(`Failed to establish connection: ${errorText}`);
      }

      const answer = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      console.log("Received SDP answer from API", answer);
      await pc.setRemoteDescription(answer);

      // Send the transcription configuration
      console.log("Sending transcription session update");
      setTimeout(() => {
        if (dc.readyState === "open") {
          const configMessage = {
            type: "transcription_session.update",
            session: {
              input_audio_format: "pcm16",
              input_audio_transcription: {
                model: "gpt-4o-mini-transcribe",
                prompt: userPrompt,
                language: selectedLanguage,
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "high",
              },
              input_audio_noise_reduction: {
                type: "near_field",
              },
            },
          };

          console.log("Sending config message:", configMessage);
          dc.send(JSON.stringify(configMessage));
        }
      }, 1000);
    } catch (error) {
      console.error("Failed to start transcription session:", error);
      setIsActivating(false);
    }
  }

  function stopTranscriptionSession() {
    if (dataChannel.current) {
      dataChannel.current.close();
    }

    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    dataChannel.current = null;
    peerConnection.current = null;
  }

  // Process the transcription with GPT-4o for corrections
  const correctTranscription = async (text, previousContext = null) => {
    try {
      // Skip correction for very short texts
      if (text.trim().length < 2) {
        return text;
      }

      // Use provided context if available, otherwise use formatted transcripts from the ref
      let context = previousContext;

      if (!context) {
        // Use the ref to get the latest value
        const latestTranscripts = transcriptsRef.current;
        if (latestTranscripts && latestTranscripts.length > 0) {
          context = latestTranscripts.map((t) => t.text).join(" ");
        } else {
          context = confirmedTextRef.current || "";
        }
      }

      console.log("Sending for correction with context:", context);
      const response = await fetch("/api/post-process-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          context,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.correctedText;
      }
      return text; // fallback to original if API fails
    } catch (error) {
      console.error("Transcription correction error:", error);
      return text; // fallback to original on error
    }
  };

  // Process word buffer for correction
  const processWordBuffer = async () => {
    if (isProcessing.current || wordBuffer.current.length === 0) {
      return;
    }

    // Mark as processing to prevent overlapping corrections
    isProcessing.current = true;

    try {
      // Join all words in the buffer
      const textToCorrect = wordBuffer.current.join(" ");

      // Use refs to get the latest values
      const latestTranscripts = transcriptsRef.current;
      let contextText = "";

      if (latestTranscripts.length > 0) {
        contextText = latestTranscripts.map((t) => t.text).join(" ");
      } else {
        contextText = confirmedTextRef.current || "";
      }

      // Send for correction with context
      const correctedText = await correctTranscription(
        textToCorrect,
        contextText
      );

      // Update confirmed text with the corrected version
      setConfirmedText((prev) => {
        const newText = prev ? `${prev} ${correctedText}` : correctedText;
        return newText;
      });

      // Clear the buffer
      wordBuffer.current = [];

      // Clear tentative text as it's now been processed
      setTentativeText("");
    } catch (error) {
      console.error("Error processing word buffer:", error);
    } finally {
      isProcessing.current = false;
      lastCorrectionTime.current = Date.now();
    }
  };

  // Schedule periodic processing of the word buffer
  useEffect(() => {
    if (!isSessionActive) return;
    const intervalId = setInterval(() => {
      const timeSinceLastCorrection = Date.now() - lastCorrectionTime.current;
      if (wordBuffer.current.length > 0 && timeSinceLastCorrection > 400) {
        // Reduced from 800ms
        processWordBuffer();
      }
    }, 250); // Reduced from 500ms
    return () => clearInterval(intervalId);
  }, [isSessionActive]);

  function handleTranscriptionEvent(event) {
    console.log("Received transcription event:", event);

    // Track recording state
    if (event.type === "input_audio_buffer.speech_started") {
      setIsRecording(true);
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      setIsRecording(false);
    }

    // Handle errors
    if (event.type === "error") {
      console.error("Transcription error:", event);
      return;
    }

    // Handle transcription delta events (incremental updates)
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const deltaText = event.delta;
      console.log("Delta text:", deltaText);

      if (deltaText && deltaText.trim()) {
        setTentativeText((prevTentative) => {
          if (/^[.,!?;:]/.test(deltaText)) {
            return prevTentative + deltaText;
          }
          const needsSpace =
            prevTentative.length > 0 && !prevTentative.endsWith(" ");
          return prevTentative + (needsSpace ? " " : "") + deltaText;
        });

        if (correctionTimeoutRef.current) {
          clearTimeout(correctionTimeoutRef.current);
        }

        correctionTimeoutRef.current = setTimeout(async () => {
          // Get the latest tentative text directly
          const currentTentative = tentativeText;
          if (currentTentative && currentTentative.trim().length > 0) {
            try {
              // Use refs to get the latest values
              const latestTranscripts = transcriptsRef.current;
              const currentConfirmedText = confirmedTextRef.current;

              // Build context from the latest values
              let contextText = currentConfirmedText || "";

              if (!contextText && latestTranscripts.length > 0) {
                contextText =
                  latestTranscripts[latestTranscripts.length - 1].text;
              }

              const correctedText = await correctTranscription(
                currentTentative,
                contextText
              );

              setConfirmedText(correctedText);
              setTentativeText("");
            } catch (error) {
              console.error("Failed to correct text:", error);
            }
          }
        }, 400); // Reduced from 800ms
      }
    }

    // Handle complete transcription events
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      // Clear any pending correction timeout
      if (correctionTimeoutRef.current) {
        clearTimeout(correctionTimeoutRef.current);
        correctionTimeoutRef.current = null;
      }

      const fullText = event.transcript;
      console.log("Completed transcription:", fullText);

      // Get context using refs to ensure latest values
      const latestTranscripts = transcriptsRef.current;
      const currentConfirmedText = confirmedTextRef.current;

      // Get context from confirmed text or recent transcripts
      let contextText = currentConfirmedText || "";

      if (!contextText && latestTranscripts.length > 0) {
        contextText = latestTranscripts[latestTranscripts.length - 1].text;
      }

      // Correct the final text with context
      correctTranscription(fullText, contextText).then((correctedText) => {
        // Add the completed transcription to the list (append at the end)
        const timestamp = new Date().toLocaleTimeString();
        setTranscripts((prev) => [
          ...prev,
          {
            id: event.item_id,
            text: correctedText,
            timestamp,
          },
        ]);

        // Clear tentative and confirmed text for next utterance
        setTentativeText("");
        setConfirmedText("");
      });
    }
  }

  const themeClass = darkMode
    ? "bg-gray-900 text-white"
    : "bg-gradient-to-br from-white to-blue-50 text-gray-800";
  const cardClass = darkMode
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const buttonPrimary = darkMode
    ? "bg-blue-600 hover:bg-blue-700 text-white"
    : "bg-blue-500 hover:bg-blue-600 text-white";
  const buttonSecondary = darkMode
    ? "bg-gray-700 hover:bg-gray-600 text-white border-gray-600"
    : "bg-white hover:bg-gray-100 text-gray-800 border-gray-300";
  const highlightClass = darkMode ? "bg-blue-900/30" : "bg-blue-50";

  return (
    <div
      className={`flex flex-col h-full ${themeClass} transition-colors duration-300 w-full max-w-4xl mx-auto`}
    >
      {!microphoneAllowed ? (
        <div className="flex flex-col items-center justify-center h-full">
          <div
            className={`rounded-xl p-8 shadow-lg max-w-md w-full ${cardClass} border transition-all duration-300 transform hover:scale-102`}
          >
            <div className="flex items-center justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center">
                <Mic size={36} className="text-blue-500" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-6">
              Voice to Text Transcription
            </h2>
            <p className="text-center mb-8 text-gray-500">
              Capture your speech in real-time with advanced AI-powered
              transcription
            </p>
            <div className="flex justify-center">
              <button
                onClick={requestMicrophonePermission}
                className={`${buttonPrimary} px-6 py-3 rounded-xl font-medium flex items-center gap-2 shadow-md transition-all duration-300 hover:shadow-lg`}
              >
                <Mic size={18} />
                Allow microphone access
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex flex-col h-full max-w-4xl mx-auto w-full p-4"
          style={{ height: "800px", width: "700px" }}
        >
          {/* Header */}
          <header
            className={`flex justify-between items-center py-3 px-6 ${cardClass} rounded-xl mb-3 border shadow-sm`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full ${buttonPrimary} flex items-center justify-center`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                  <rect x="5" y="20" width="14" height="2" rx="1"></rect>
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold">Realtime Transcription</h2>
              </div>
            </div>
          </header>

          {/* Configuration Panel */}
          <div
            className={`mb-3 ${cardClass} rounded-xl border p-3 shadow-sm transition-all duration-300`}
          >
            <div className="flex flex-col gap-4">
              {/* First row: Language and Actions */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block mb-1 text-sm font-medium text-gray-600">
                    Language
                  </label>
                  <div className="relative">
                    <select
                      className={`w-full p-2 rounded-lg border ${
                        darkMode
                          ? "bg-gray-700 border-gray-600 text-white"
                          : "bg-white border-gray-300 text-gray-800"
                      } appearance-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                    >
                      <option value="da">Danish</option>
                      <option value="en">English</option>
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                      <ChevronDown size={16} className="opacity-70" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={copyTranscriptsToClipboard}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg ${buttonSecondary} border hover:bg-gray-50 transition-colors`}
                  >
                    <Clipboard size={16} />
                    <span className="text-sm">Copy</span>
                  </button>
                  <button
                    onClick={downloadTranscriptsAsText}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg ${buttonSecondary} border hover:bg-gray-50 transition-colors`}
                  >
                    <Download size={16} />
                    <span className="text-sm">Download</span>
                  </button>
                  <button
                    onClick={() => setTranscripts([])}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg ${buttonSecondary} border hover:bg-gray-50 transition-colors`}
                  >
                    <RefreshCw size={16} />
                    <span className="text-sm">Clear</span>
                  </button>
                </div>
              </div>

              {/* Second row: Prompt spanning full width */}
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-600">
                  User Prompt
                </label>
                <textarea
                  className={`w-full p-2 rounded-lg border ${
                    darkMode
                      ? "bg-gray-700 border-gray-600 text-white"
                      : "bg-white border-gray-300 text-gray-800"
                  } focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="Enter any specific instructions or context for the transcription..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Main transcript area */}
          <main
            ref={transcriptContainerRef}
            className={`flex-1 overflow-y-auto overflow-x-hidden ${cardClass} rounded-xl border p-6 mb-3 shadow-sm transition-all duration-300`}
            style={{ maxWidth: "700px", minHeight: "400px" }}
          >
            {isRecording && (
              <div className="mb-4 flex items-center px-4 py-2 rounded-full bg-red-100 text-red-600 w-fit">
                <span className="inline-block h-3 w-3 rounded-full bg-red-500 mr-2 animate-pulse"></span>
                <span className="font-medium">Recording...</span>
              </div>
            )}

            {transcripts.length > 0 || confirmedText || tentativeText ? (
              <div className="space-y-4">
                <div className="text-lg">
                  {transcripts.length > 0 && (
                    <p className="leading-relaxed">
                      {transcripts.map((transcript) => (
                        <React.Fragment key={transcript.id}>
                          {transcript.text}{" "}
                        </React.Fragment>
                      ))}
                    </p>
                  )}

                  {(confirmedText || tentativeText) && (
                    <>
                      {confirmedText}
                      {tentativeText && (
                        <span
                          className={`italic ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          }`}
                        >
                          {tentativeText}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              !isActivating &&
              !isSessionActive && (
                <div className="h-full flex flex-col items-center justify-center text-center py-10 opacity-70">
                  <div
                    className={`w-16 h-16 rounded-full ${buttonSecondary} flex items-center justify-center mb-4 border-2`}
                  >
                    <Mic size={24} />
                  </div>
                  <p className="max-w-sm">
                    Start a session to begin transcribing your speech in
                    real-time
                  </p>
                </div>
              )
            )}
          </main>

          {/* Control panel */}
          <footer
            className={`${cardClass} rounded-xl border p-4 shadow-sm transition-all duration-300`}
          >
            <div className="flex items-center justify-center gap-4">
              {isSessionActive ? (
                <button
                  onClick={stopTranscriptionSession}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl shadow-sm hover:shadow ${
                    darkMode
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-red-500 hover:bg-red-600"
                  } text-white font-medium transition-all duration-300`}
                >
                  <div className="h-3 w-3 bg-white rounded-sm"></div>
                  Stop Recording
                </button>
              ) : (
                <button
                  onClick={startTranscriptionSession}
                  disabled={isActivating}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium shadow-sm hover:shadow transition-all duration-300
                    ${
                      isActivating
                        ? "bg-gray-400 text-white"
                        : `${buttonPrimary}`
                    }`}
                >
                  {isActivating ? (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Starting...
                    </>
                  ) : (
                    <>
                      <Mic size={18} />
                      Start Recording
                    </>
                  )}
                </button>
              )}

              <button
                onClick={() => {
                  // Demo functionality
                  setTimeout(() => {
                    setTentativeText("i want to talk about");
                  }, 0);
                  setTimeout(() => {
                    setConfirmedText("I want to talk about");
                    setTentativeText(" software development using the new STK");
                  }, 1000);
                  setTimeout(() => {
                    setConfirmedText(
                      "I want to talk about software development using the new SDK"
                    );
                    setTentativeText(" for building ay pee eye services");
                  }, 2000);
                  setTimeout(() => {
                    setConfirmedText(
                      "I want to talk about software development using the new SDK for building API services"
                    );
                    setTentativeText(" with web are tea sea connections");
                  }, 3000);
                  setTimeout(() => {
                    setConfirmedText(
                      "I want to talk about software development using the new SDK for building API services with WebRTC connections"
                    );
                    setTentativeText(
                      ". This technology allows for real time communication between browsers."
                    );
                  }, 4000);
                  setTimeout(() => {
                    const finalText =
                      "I want to talk about software development using the new SDK for building API services with WebRTC connections. This technology allows for real-time communication between browsers.";
                    setConfirmedText("");
                    setTentativeText("");
                    setTranscripts((prev) => [
                      ...prev,
                      {
                        id: "test-" + Date.now(),
                        text: finalText,
                        timestamp: new Date().toLocaleTimeString(),
                      },
                    ]);
                  }, 5500);

                  setTimeout(() => {
                    setTentativeText("And now let's look at how");
                  }, 7000);
                  setTimeout(() => {
                    setConfirmedText("And now let's look at how");
                    setTentativeText(
                      " we can integrate this with our existing platform"
                    );
                  }, 8000);
                  setTimeout(() => {
                    const secondText =
                      "And now let's look at how we can integrate this with our existing platform.";
                    setConfirmedText("");
                    setTentativeText("");
                    setTranscripts((prev) => [
                      ...prev,
                      {
                        id: "test-" + Date.now() + 1,
                        text: secondText,
                        timestamp: new Date().toLocaleTimeString(),
                      },
                    ]);
                  }, 9000);
                }}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl ${
                  darkMode
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-emerald-500 hover:bg-emerald-600"
                } text-white font-medium shadow-sm hover:shadow transition-all duration-300`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Demo
              </button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
