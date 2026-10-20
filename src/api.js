let csrfToken = '';
export function setCsrfToken(value) { csrfToken = value || ''; }
export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers }
  });
  if (response.status === 204) return;
  let data;
  try { data = await response.json(); } catch { throw new Error('The server is starting or unavailable. Please try again.'); }
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    const error = new Error(data.error || 'Unable to complete this request.'); error.status = response.status; throw error;
  }
  return data;
}
