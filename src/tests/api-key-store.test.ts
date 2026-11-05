import { describe, expect, it } from 'vitest'
import { API_KEY_STORAGE_KEY, clearApiKey, readApiKey, saveApiKey } from '../storage/apiKeyStore'

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
})
