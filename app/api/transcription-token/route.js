import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    // Get language and prompt from query parameters
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language") || "en";
    const prompt = searchParams.get("prompt") || "";

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
            language: language,
            prompt: "",
          },
          input_audio_noise_reduction: {
            type: "near_field",
          },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "high",
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
