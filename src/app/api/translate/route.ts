import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://api.siliconflow.cn/v1',
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY
});

export async function POST(request: Request) {
  try {
    const { texts, systemPrompt, targetLanguage, batchIndex, totalBatches } = await request.json();
    if (!Array.isArray(texts)) {
      return NextResponse.json(
        { error: 'texts must be an array' },
        { status: 400 }
      );
    }

    const stream = await openai.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n请使用\u0001作为分隔符返回翻译结果，不要使用换行符。`
        },
        {
          role: 'user',
          content: texts.join('\u0001')
        }
      ],
      temperature: 0.3,
      max_tokens: 1000,
      stream: true
    });

    const encoder = new TextEncoder();
    const stream_response = new ReadableStream({
      async start(controller) {
        let translatedText = '';
        let currentTranslations = [];
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          translatedText += content;
          const parts = translatedText.split('');
          currentTranslations = parts.slice(0, texts.length).map(text => text.trim());
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            translatedText: currentTranslations,
            batchIndex,
            totalBatches
          })}\n\n`));
        }
        controller.close();
      }
    });

    return new Response(stream_response, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })
  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    );
  }
}