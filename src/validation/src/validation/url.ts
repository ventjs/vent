export type UrlCheck = 'ok' | 'invalid' | 'protocol'

// Strict http(s) URL check: `new URL()` alone is too lenient
// (it accepts "mailto:", "javascript:", "http:example.com", "http:///x", ...).
export function checkUrl(value: string): UrlCheck {
  if (value !== value.trim() || /\s/.test(value)) return 'invalid'

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'invalid'
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'protocol'
  }

  // require an explicit "//" followed by a real host
  if (!/^https?:\/\/[^/\\?#@]/i.test(value) || url.hostname === '') {
    return 'invalid'
  }

  return 'ok'
}
