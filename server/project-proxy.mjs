import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = dirname(fileURLToPath(import.meta.url))
const dataDirectory = resolve(process.env.PROJECT_DATA_DIR || join(serverDirectory, 'data'))
const port = Number(process.env.PORT || 8787)
const expectedToken = process.env.SYNC_TOKEN || ''
const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:5173'
const maxBytes = 10 * 1024 * 1024

await mkdir(dataDirectory, { recursive: true })

function headers(origin = allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  }
}

function send(response, status, body, origin) {
  response.writeHead(status, headers(origin))
  response.end(JSON.stringify(body))
}

function authorized(request) {
  if (!expectedToken) return false
  return request.headers.authorization === `Bearer ${expectedToken}`
}

function projectIdFrom(pathname) {
  const match = pathname.match(/^\/projects\/([a-zA-Z0-9_-]{8,80})$/)
  return match?.[1] ?? null
}

async function requestBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBytes) throw new Error('too-large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

createServer(async (request, response) => {
  const origin = request.headers.origin || allowedOrigin
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers(origin))
    response.end()
    return
  }
  if (!authorized(request)) { send(response, 401, { error: 'Unauthorized' }, origin); return }
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const projectId = projectIdFrom(url.pathname)
  if (!projectId) { send(response, 404, { error: 'Not found' }, origin); return }
  const target = join(dataDirectory, `${projectId}.json`)
  try {
    if (request.method === 'GET') {
      const body = await readFile(target, 'utf8')
      response.writeHead(200, headers(origin))
      response.end(body)
      return
    }
    if (request.method === 'PUT') {
      const value = await requestBody(request)
      if (value?.schemaVersion !== '1.0' || value?.project?.id !== projectId || !Array.isArray(value?.papers)) {
        send(response, 400, { error: 'Invalid PaperNavigator bundle' }, origin)
        return
      }
      const serialized = JSON.stringify(value)
      if (/"(?:apiKey|api_key|accessToken|token)"\s*:/.test(serialized)) {
        send(response, 400, { error: 'Secrets are not accepted' }, origin)
        return
      }
      const temporary = join(dataDirectory, `${projectId}.${Date.now()}.tmp`)
      await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
      send(response, 200, { ok: true, projectId }, origin)
      return
    }
    send(response, 405, { error: 'Method not allowed' }, origin)
  } catch (error) {
    if (error?.code === 'ENOENT') send(response, 404, { error: 'Project not found' }, origin)
    else if (error?.message === 'too-large') send(response, 413, { error: 'Project exceeds 10 MB' }, origin)
    else send(response, 500, { error: 'Server error' }, origin)
  }
}).listen(port, () => {
  process.stdout.write(`PaperNavigator project proxy listening on http://localhost:${port}\n`)
})
