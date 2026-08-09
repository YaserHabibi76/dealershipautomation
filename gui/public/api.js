const Api = {
  async get(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `GET ${url} failed (${res.status})`);
    return data;
  },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${url} failed (${res.status})`);
    return data;
  },
  put(url, body) { return Api.send('PUT', url, body); },
  post(url, body) { return Api.send('POST', url, body); },
};
