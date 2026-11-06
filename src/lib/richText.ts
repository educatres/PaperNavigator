const ALLOWED_HTML_TAGS = new Set([
  'article', 'section', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
  'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
])

const VOID_HTML_TAGS = new Set(['br', 'hr'])

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeHtmlText(value: string) {
  return value.replace(/&(?!#\d+;|#x[\da-f]+;|[a-z][\da-z]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function markdownToHtml(value: string) {
  const escaped = escapeHtml(value)
  const inline = (line: string) => line
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const blocks = escaped.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
  return blocks.map((block) => {
    const lines = block.split('\n')
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`
    if (lines.length === 1) {
      const heading = lines[0].match(/^\s*(#{1,4})\s+(.+)$/)
      if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`
    }
    return `<p>${lines.map(inline).join('<br />')}</p>`
  }).join('')
}

export function sanitizeReportHtml(value: string) {
  const withoutDangerousBlocks = value
    .replace(/<(script|style|iframe|object|embed|svg|math|form|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi
  let result = ''
  let cursor = 0

  for (const match of withoutDangerousBlocks.matchAll(tagPattern)) {
    const index = match.index ?? 0
    result += escapeHtmlText(withoutDangerousBlocks.slice(cursor, index))
    const token = match[0]
    const tag = token.match(/^<\s*(\/?)\s*([a-z][\w-]*)/i)
    if (tag) {
      const closing = Boolean(tag[1])
      const name = tag[2].toLowerCase()
      if (ALLOWED_HTML_TAGS.has(name)) result += closing && !VOID_HTML_TAGS.has(name) ? `</${name}>` : `<${name}>`
    }
    cursor = index + token.length
  }
  result += escapeHtmlText(withoutDangerousBlocks.slice(cursor))
  return result.trim()
}

function unwrapHtmlFence(value: string) {
  return value.trim().match(/^```html\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? value.trim()
}

export function richTextToHtml(value: string) {
  const unwrapped = unwrapHtmlFence(value)
  const containsHtml = /<(?:article|section|div|h[1-4]|p|ul|ol|li|table|blockquote|pre|strong|em|br|hr)\b[^>]*>/i.test(unwrapped)
  return containsHtml ? sanitizeReportHtml(unwrapped) : markdownToHtml(value)
}
