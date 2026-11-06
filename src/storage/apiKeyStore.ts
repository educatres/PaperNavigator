import type { ProviderConfig, ProviderId } from '../domain/types'

export const API_KEY_STORAGE_KEY = 'papernavigator.api-keys.v1'
export const AI_SETTINGS_STORAGE_KEY = 'papernavigator.ai-settings.v1'
const DEPRECATED_SETTINGS_STORAGE_KEY = 'papernavigator.proxy-settings.v1'

type ApiKeyMap = Partial<Record<ProviderId, string>>
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type StoredSettings = {
  activeProvider?: ProviderId
  providers?: Partial<Record<ProviderId, Omit<ProviderConfig, 'id'>>>
}

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

function readSettings(storage: StorageLike): StoredSettings {
  try {
    const raw = storage.getItem(AI_SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as StoredSettings
  } catch {
    return {}
  }
}

function writeSettings(value: StoredSettings, storage: StorageLike) {
  storage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(value))
}

export function readActiveProvider(storage?: StorageLike): ProviderId {
  try {
    const provider = readSettings(storage ?? window.localStorage).activeProvider
    return provider === 'google' || provider === 'cgu' ? provider : 'cgu'
  } catch {
    return 'cgu'
  }
}

export function readProviderConfig(provider: ProviderId, defaults: ProviderConfig, storage?: StorageLike): ProviderConfig {
  try {
    const target = storage ?? window.localStorage
    const saved = readSettings(target).providers?.[provider]
    return {
      id: provider,
      apiKey: typeof saved?.apiKey === 'string' ? saved.apiKey : readApiKey(provider, target),
      baseUrl: typeof saved?.baseUrl === 'string' && saved.baseUrl ? saved.baseUrl : defaults.baseUrl,
      modelId: typeof saved?.modelId === 'string' ? saved.modelId : defaults.modelId,
    }
  } catch {
    return defaults
  }
}

export function saveProviderConfig(config: ProviderConfig, storage?: StorageLike) {
  try {
    const target = storage ?? window.localStorage
    const current = readSettings(target)
    writeSettings({
      ...current,
      activeProvider: config.id,
      providers: { ...current.providers, [config.id]: { apiKey: config.apiKey, baseUrl: config.baseUrl, modelId: config.modelId } },
    }, target)
    saveApiKey(config.id, config.apiKey, target)
  } catch {
    // The current React state remains usable when browser storage is unavailable.
  }
}

export function clearProviderConfig(provider: ProviderId, storage?: StorageLike) {
  try {
    const target = storage ?? window.localStorage
    const current = readSettings(target)
    const providers = { ...current.providers }
    delete providers[provider]
    writeSettings({ ...current, providers }, target)
    clearApiKey(provider, target)
  } catch {
    // Ignore storage restrictions; the caller also resets its in-memory state.
  }
}

export function clearAllSettings(storage?: StorageLike) {
  try {
    const target = storage ?? window.localStorage
    target.removeItem(API_KEY_STORAGE_KEY)
    target.removeItem(AI_SETTINGS_STORAGE_KEY)
    target.removeItem(DEPRECATED_SETTINGS_STORAGE_KEY)
  } catch {
    // The caller also clears its in-memory state.
  }
}
