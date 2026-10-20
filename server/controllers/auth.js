import { register, login, createSession, cookieOptions } from '../services/auth.js';
import { AuthSession } from '../models/AuthSession.js';
import { cookieName, publicUser } from '../middleware/auth.js';
export const registerUser = async (req, res) => res.status(201).json(await createSession(await register(req.body), req, res));
export const loginUser = async (req, res) => res.json(await createSession(await login(req.body), req, res));
export const currentUser = (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.authSession.csrfToken });
export const logoutUser = async (req, res) => { await AuthSession.deleteOne({ _id: req.authSession._id }); res.clearCookie(cookieName, cookieOptions()); res.status(204).end(); };
