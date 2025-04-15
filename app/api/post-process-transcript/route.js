import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { text, context, prompt } = await request.json();

    console.log("text", text);
    console.log("context", context);
    console.log("prompt", prompt);
    if (!text || text.trim() === "") {
      return NextResponse.json({ correctedText: text });
    }

    // Format the context to include a significant portion of previous transcripts
    const formattedContext = context ? `Previous context: "${context}"` : "";

    const messages = [
      {
        role: "system",
        content: `You are a specialized speech-to-text correction system. Your task is to correct transcription errors while maintaining the original meaning and context.
            Here's the user instructions always follow them and give them precedence over the general guidelines: ${prompt}
            
            Below are the general guidelines make sure to only follow them if they are not conflicting with the user instructions:

            You have to correct any spelling, grammar, punctuation, capitalization, word errors, typos, etc. Make to not override anything mentioned in the user instructions.

            ${formattedContext}

            Return only the corrected text without any explanations or additional formatting.
        `,
      },

      {
        role: "user",
        content: `Current transcript to correct: "${text}"`,
      },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages,
      }),
    });

    const data = await response.json();
    console.log("data", messages);
    let correctedText = text;

    if (data.choices && data.choices.length > 0) {
      correctedText = data.choices[0].message.content.trim();
      console.log("correctedText", correctedText);
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
