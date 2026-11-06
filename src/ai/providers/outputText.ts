interface TextPart {
  type?: string
  text?: string
  thought?: boolean
}

interface ResponseOutputItem {
  type: string
  role?: string
  channel?: string
  content?: TextPart[]
}

export function responsesText(body: { output_text?: string; output?: ResponseOutputItem[] }) {
  if (body.output?.length) {
    // Reasoning and echoed input are separate API items, never answer text.
    return body.output
      .filter((item) => item.type === 'message' && item.role === 'assistant' && (!item.channel || item.channel === 'final'))
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
  }
  return typeof body.output_text === 'string' ? body.output_text : ''
}

export function googleText(body: { candidates?: Array<{ content?: { parts?: TextPart[] } }> }) {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}
