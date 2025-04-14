import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { text, context } = await request.json();

    console.log("text", text);
    console.log("context", context);
    if (!text || text.trim() === "") {
      return NextResponse.json({ correctedText: text });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a specialized speech-to-text correction system. Your task is to correct transcription errors while maintaining the original meaning and context.

Guidelines:
1. Basic Corrections:
   - Fix spelling and grammar errors
   - Correct punctuation and capitalization
   - Fix common word errors and typos

2. Contextual Understanding:
   - Consider the conversation flow and context
   - Maintain consistency with previous statements
   - Preserve technical terms and domain-specific language
   - Handle acronyms correctly (e.g., API, SDK, CLI, UI, UX, WebRTC)

3. Technical Accuracy:
   - Correct technical terms and jargon
   - Fix common transcription errors in technical content
   - Maintain proper formatting of code and technical concepts

4. Natural Language:
   - Ensure natural sentence flow
   - Maintain proper paragraph structure
   - Preserve the speaker's tone and style

Return only the corrected text without any explanations or additional formatting.`,
          },
          ...(context
            ? [
                {
                  role: "user",
                  content: `Previous transcripts: "${context}"`,
                },
              ]
            : []),
          {
            role: "user",
            content: `Correct this transcription: "${text}"`,
          },
        ],
        include: ["item.input_audio_transcription.logprobs"],
        temperature: 0.2,
        max_tokens: 256,
      }),
    });

    const data = await response.json();
    let correctedText = text;

    if (data.choices && data.choices.length > 0) {
      correctedText = data.choices[0].message.content.trim();
      correctedText = correctedText.replace(/^["'](.*)["']$/s, "$1");
    }

    return NextResponse.json({ correctedText });
  } catch (error) {
    console.error("Transcript correction error:", error);
    return NextResponse.json(
      {
        error: "Failed to correct transcript",
        correctedText: text,
      },
      { status: 500 }
    );
  }
}
