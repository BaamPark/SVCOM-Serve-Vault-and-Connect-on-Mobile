import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "Request failed";
    throw new Error(message);
  }

  return payload;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    api("/api/auth/status")
      .then((payload) => {
        if (active && payload.authenticated) {
          router.replace("/app");
        }
      })
      .catch(() => {
        if (active) {
          setError("Unable to reach the backend.");
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      router.replace("/app");
    } catch (submitError) {
      setError(submitError.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>Vault Login</title>
      </Head>
      <main className="login-screen">
        <form className="card login-card" onSubmit={onSubmit}>
          <h1>Vault Browser</h1>
          <p>Enter the server password to access your vault.</p>
          <label className="stack">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Unlocking..." : "Unlock Vault"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </main>
    </>
  );
}
