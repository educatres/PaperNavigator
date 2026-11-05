import type { ProviderId } from '../domain/types'

export const API_KEY_STORAGE_KEY = 'papernavigator.api-keys.v1'

type ApiKeyMap = Partial<Record<ProviderId, string>>
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function readMap(storage: StorageLike): ApiKeyMap {
  try {
    const raw = storage.getItem(API_KEY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const source = parsed as Record<string, unknown>
    return {
      ...(typeof source.google === 'string' && source.google ? { google: source.google } : {}),
      ...(typeof source.cgu === 'string' && source.cgu ? { cgu: source.cgu } : {}),
    }
  } catch {
    return {}
  }
}

export function readApiKey(provider: ProviderId, storage?: StorageLike) {
  try {
    return readMap(storage ?? window.localStorage)[provider] ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(provider: ProviderId, apiKey: string, storage?: StorageLike) {
  try {
    const target = storage ?? window.localStorage
    const next = readMap(target)
    if (apiKey) next[provider] = apiKey
    else delete next[provider]

    if (Object.keys(next).length) target.setItem(API_KEY_STORAGE_KEY, JSON.stringify(next))
    else target.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // localStorage may be unavailable in hardened browser modes; the in-memory field still works.
  }
}

export function clearApiKey(provider: ProviderId, storage?: StorageLike) {
  saveApiKey(provider, '', storage)
}
