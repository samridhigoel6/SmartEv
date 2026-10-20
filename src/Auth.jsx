import { createContext, useContext, useEffect, useState } from 'react';
import { LoaderCircle, Zap, LogIn } from 'lucide-react';
import { api, setCsrfToken } from './api.js';
import './auth.css';
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const accept = result => { setCsrfToken(result.csrfToken); setUser(result.user); setError(''); };
  useEffect(() => {
    let mounted = true;
    api('/auth/me').then(result => { if (mounted) accept(result); }).catch(e => { if (mounted && e.status !== 401) setError(e.message); }).finally(() => { if (mounted) setLoading(false); });
    const expired = () => { setUser(null); setCsrfToken(''); setError('Your session expired. Please sign in again.'); };
    window.addEventListener('session-expired', expired);
    return () => { mounted = false; window.removeEventListener('session-expired', expired); };
  }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setCsrfToken(''); };
  if (loading) return <div className="loading"><LoaderCircle className="spin"/>Checking your session…</div>;
  if (!user) return <AuthScreen onSignedIn={accept} initialError={error}/>;
  return <AuthContext.Provider value={{ user, isAdmin: user.role === 'admin', logout, refreshProfile: async () => accept(await api('/auth/me')) }}>{children}</AuthContext.Provider>;
}
function AuthScreen({ onSignedIn, initialError }) {
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(initialError);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try { onSignedIn(await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(fields) })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="panel auth-card"><div className="auth-brand"><span className="brand-mark"><Zap fill="currentColor" size={23}/></span><strong>smart<span>ev</span></strong></div><div className="modal-heading"><div><div className="eyebrow">CHARGING, CONNECTED.</div><h1>{register ? 'Join your charging network.' : 'Welcome to Smart EV.'}</h1><p>{register ? 'Create your driver account.' : 'Sign in to your charging workspace.'}</p></div></div><form onSubmit={submit}><div className="form-body">{error && <div className="form-error" role="alert">{error}</div>}{register && <label className="field"><span>Full name</span><input name="name" aria-label="Full name" autoComplete="name" required maxLength={100}/></label>}<label className="field"><span>Email address</span><input name="email" aria-label="Email address" type="email" autoComplete="username" required maxLength={254}/></label><label className="field"><span>Password</span><input name="password" aria-label="Password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={10} required/></label>{register && <p className="auth-note">At least 10 characters. Accounts are created with driver access.</p>}<button className="button primary auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <LogIn size={17}/>} {register ? 'Create account' : 'Sign in'}</button><button type="button" className="auth-switch" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already registered? Sign in' : 'New driver? Create an account'}</button></div></form></section></main>;
}
