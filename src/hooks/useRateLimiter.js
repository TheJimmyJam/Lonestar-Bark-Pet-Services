import { useState, useEffect, useRef, useCallback } from "react";

// ─── PIN Rate Limiter Hook ───────────────────────────────────────────────────
// Tracks failed PIN attempts per account key (email).
// After MAX_ATTEMPTS failures, locks out for LOCKOUT_MS.
// Persists to localStorage so refreshing doesn't reset the counter.

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const LS_KEY = "lsb_pin_lockouts";

function loadLockouts() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLockouts(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

function getRecord(key) {
  const all = loadLockouts();
  const rec = all[key];
  if (!rec) return { attempts: 0, lockedUntil: 0 };
  // If lockout has expired, reset
  if (rec.lockedUntil && Date.now() > rec.lockedUntil) {
    delete all[key];
    saveLockouts(all);
    return { attempts: 0, lockedUntil: 0 };
  }
  return rec;
}

function setRecord(key, rec) {
  const all = loadLockouts();
  all[key] = rec;
  saveLockouts(all);
}

function clearRecord(key) {
  const all = loadLockouts();
  delete all[key];
  saveLockouts(all);
}

export default function useRateLimiter(accountKey) {
  const normalizedKey = (accountKey || "").trim().toLowerCase();
  const [locked, setLocked] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const timerRef = useRef(null);

  // Sync state from localStorage whenever accountKey changes
  const syncState = useCallback(() => {
    if (!normalizedKey) { setLocked(false); setRemainingMs(0); setAttempts(0); return; }
    const rec = getRecord(normalizedKey);
    setAttempts(rec.attempts);
    if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
      setLocked(true);
      setRemainingMs(rec.lockedUntil - Date.now());
    } else {
      setLocked(false);
      setRemainingMs(0);
    }
  }, [normalizedKey]);

  useEffect(() => { syncState(); }, [syncState]);

  // Countdown timer when locked
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!locked) return;
    timerRef.current = setInterval(() => {
      const rec = getRecord(normalizedKey);
      if (!rec.lockedUntil || Date.now() >= rec.lockedUntil) {
        setLocked(false);
        setRemainingMs(0);
        setAttempts(0);
        clearInterval(timerRef.current);
      } else {
        setRemainingMs(rec.lockedUntil - Date.now());
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [locked, normalizedKey]);

  // Call this on a failed PIN attempt. Returns true if now locked out.
  const recordFailure = useCallback(() => {
    if (!normalizedKey) return false;
    const rec = getRecord(normalizedKey);
    const newAttempts = rec.attempts + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      const lockedUntil = Date.now() + LOCKOUT_MS;
      setRecord(normalizedKey, { attempts: newAttempts, lockedUntil });
      setLocked(true);
      setRemainingMs(LOCKOUT_MS);
      setAttempts(newAttempts);
      return true;
    }
    setRecord(normalizedKey, { attempts: newAttempts, lockedUntil: 0 });
    setAttempts(newAttempts);
    return false;
  }, [normalizedKey]);

  // Call this on successful login to clear the counter
  const clearFailures = useCallback(() => {
    if (!normalizedKey) return;
    clearRecord(normalizedKey);
    setLocked(false);
    setRemainingMs(0);
    setAttempts(0);
  }, [normalizedKey]);

  // Format remaining time for display
  const formatRemaining = () => {
    if (remainingMs <= 0) return "";
    const totalSec = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return {
    locked,
    attempts,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
    remainingMs,
    formatRemaining,
    recordFailure,
    clearFailures,
    MAX_ATTEMPTS,
  };
}
