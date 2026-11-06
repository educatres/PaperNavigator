import { describe, expect, it } from 'vitest'
import { AI_SETTINGS_STORAGE_KEY, API_KEY_STORAGE_KEY, clearAllSettings, clearApiKey, clearProviderConfig, readActiveProvider, readApiKey, readProviderConfig, saveApiKey, saveProviderConfig } from '../storage/apiKeyStore'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('API Key localStorage', () => {
  it('依服務來源分別保存並讀回 Key', () => {
    const storage = new MemoryStorage()
    saveApiKey('google', 'google-secret', storage)
    saveApiKey('cgu', 'cgu-secret', storage)

    expect(readApiKey('google', storage)).toBe('google-secret')
    expect(readApiKey('cgu', storage)).toBe('cgu-secret')
  })

  it('只清除指定服務來源的 Key', () => {
    const storage = new MemoryStorage()
    saveApiKey('google', 'google-secret', storage)
    saveApiKey('cgu', 'cgu-secret', storage)
    clearApiKey('google', storage)

    expect(readApiKey('google', storage)).toBe('')
    expect(readApiKey('cgu', storage)).toBe('cgu-secret')
  })

  it('損毀或無效的儲存值不會讓應用程式崩潰', () => {
    const storage = new MemoryStorage()
    storage.setItem(API_KEY_STORAGE_KEY, '{broken')
    expect(readApiKey('google', storage)).toBe('')

    storage.setItem(API_KEY_STORAGE_KEY, JSON.stringify({ google: 123, cgu: 'valid' }))
    expect(readApiKey('google', storage)).toBe('')
    expect(readApiKey('cgu', storage)).toBe('valid')
  })

  it('保存並恢復 Provider、Base URL、模型與 API Key', () => {
    const storage = new MemoryStorage()
    saveProviderConfig({ id: 'cgu', apiKey: 'secret', baseUrl: 'https://example.test/v1', modelId: 'gemma-4-26b-a4b-it' }, storage)

    expect(readActiveProvider(storage)).toBe('cgu')
    expect(readProviderConfig('cgu', { id: 'cgu', apiKey: '', baseUrl: 'fallback', modelId: '' }, storage)).toEqual({
      id: 'cgu', apiKey: 'secret', baseUrl: 'https://example.test/v1', modelId: 'gemma-4-26b-a4b-it',
    })
  })

  it('清除指定 Provider 的完整設定', () => {
    const storage = new MemoryStorage()
    saveProviderConfig({ id: 'cgu', apiKey: 'secret', baseUrl: 'https://example.test/v1', modelId: 'gpt-oss-120b' }, storage)
    clearProviderConfig('cgu', storage)

    expect(readProviderConfig('cgu', { id: 'cgu', apiKey: '', baseUrl: 'fallback', modelId: 'default' }, storage)).toEqual({
      id: 'cgu', apiKey: '', baseUrl: 'fallback', modelId: 'default',
    })
    expect(storage.getItem(AI_SETTINGS_STORAGE_KEY)).toContain('providers')
  })

  it('紅色清除會移除 Provider、Key 與舊版設定殘留', () => {
    const storage = new MemoryStorage()
    saveProviderConfig({ id: 'cgu', apiKey: 'secret', baseUrl: 'https://example.test/v1', modelId: 'gpt-oss-120b' }, storage)
    storage.setItem('papernavigator.proxy-settings.v1', JSON.stringify({ token: 'legacy-token' }))

    clearAllSettings(storage)
    expect(storage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(AI_SETTINGS_STORAGE_KEY)).toBeNull()
    expect(storage.getItem('papernavigator.proxy-settings.v1')).toBeNull()
  })
})
