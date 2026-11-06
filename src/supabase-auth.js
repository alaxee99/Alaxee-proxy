export const AUTH_SESSION_STORAGE_KEY = "alaxeeSupabaseSession";

function safeUser(user) {
  if (!user || typeof user.id !== "string") return null;
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : "",
    emailConfirmedAt: user.email_confirmed_at ?? null
  };
}

function makeAuthError(payload, status) {
  const message = payload?.msg || payload?.message || payload?.error_description ||
    payload?.error || "ALAXEE 账户服务请求失败。";
  const error = new Error(String(message));
  error.status = status;
  error.code = payload?.error_code || payload?.code || payload?.error || null;
  return error;
}

export function createSupabaseAuthService({
  supabaseUrl,
  publishableKey,
  storage,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = 12000
}) {
  if (!/^https:\/\//.test(String(supabaseUrl || ""))) {
    throw new Error("A valid Supabase HTTPS URL is required.");
  }
  if (typeof publishableKey !== "string" || !publishableKey.startsWith("sb_publishable_")) {
    throw new Error("A Supabase publishable key is required.");
  }
  if (!storage || typeof storage.get !== "function" ||
      typeof storage.set !== "function" || typeof storage.remove !== "function") {
    throw new Error("A storage adapter with get/set/remove is required.");
  }
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  let refreshInFlight = null;

  async function request(path, { method = "GET", body, accessToken } = {}) {
    const headers = { apikey: publishableKey };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response;
    try {
      const signal = typeof AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {})
      });
    } catch {
      throw new Error("无法连接 ALAXEE 账户服务，请检查网络后重试。");
    }

    let payload = null;
    if (response.status !== 204) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!response.ok) throw makeAuthError(payload, response.status);
    return payload;
  }

  async function readStoredSession() {
    const stored = await storage.get(AUTH_SESSION_STORAGE_KEY);
    const session = stored?.[AUTH_SESSION_STORAGE_KEY] ?? null;
    if (!session || typeof session.access_token !== "string" ||
        typeof session.refresh_token !== "string") return null;
    return session;
  }

  async function saveSession(payload) {
    if (typeof payload?.access_token !== "string" ||
        typeof payload?.refresh_token !== "string") {
      throw new Error("账户服务未返回有效会话。");
    }
    const expiresIn = Number(payload.expires_in);
    const expiresAt = Number(payload.expires_at) > 0
      ? Number(payload.expires_at) * 1000
      : now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000);
    const session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: expiresAt,
      token_type: payload.token_type || "bearer"
    };
    // The account password is never persisted. Supabase rotates refresh tokens.
    await storage.set({ [AUTH_SESSION_STORAGE_KEY]: session });
    return session;
  }

  async function clearSession() {
    await storage.remove(AUTH_SESSION_STORAGE_KEY);
  }

  async function refreshSession(session) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const payload = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token }
      });
      return saveSession(payload);
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function signInWithPassword({ email, password }) {
    const normalizedEmail = String(email || "").trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw new Error("请输入有效的 ALAXEE 账户邮箱。");
    }
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("请输入账户密码。");
    }
    const payload = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: normalizedEmail, password }
    });
    await saveSession(payload);
    const user = safeUser(payload.user);
    if (!user) {
      await clearSession();
      throw new Error("账户服务未返回有效的用户身份。");
    }
    return user;
  }

  async function getSession() {
    let session = await readStoredSession();
    if (!session) return null;

    try {
      if (!Number.isFinite(Number(session.expires_at)) ||
          Number(session.expires_at) <= now() + 60_000) {
        session = await refreshSession(session);
      }

      let user;
      try {
        user = await request("/auth/v1/user", { accessToken: session.access_token });
      } catch (error) {
        if (error.status !== 401) throw error;
        session = await refreshSession(session);
        user = await request("/auth/v1/user", { accessToken: session.access_token });
      }

      const safe = safeUser(user);
      if (!safe) throw new Error("账户服务未返回有效的用户身份。");
      return { user: safe };
    } catch (error) {
      if ([400, 401, 403].includes(error.status)) {
        await clearSession();
        return null;
      }
      throw error;
    }
  }

  async function signOut() {
    const session = await readStoredSession();
    let remoteRevoked = true;
    if (session?.access_token) {
      try {
        await request("/auth/v1/logout?scope=local", {
          method: "POST",
          accessToken: session.access_token
        });
      } catch {
        remoteRevoked = false;
      }
    }
    await clearSession();
    return { remoteRevoked };
  }

  return Object.freeze({ signInWithPassword, getSession, signOut });
}
