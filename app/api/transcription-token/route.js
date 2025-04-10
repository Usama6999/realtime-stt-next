import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/transcription_sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input_audio_format: "pcm16",
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "en",
            prompt: "",
          },
          input_audio_noise_reduction: {
            type: "near_field",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.3,
            prefix_padding_ms: 150,
            silence_duration_ms: 300,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Session creation error:", errorText);
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("Created transcription session:", data);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
