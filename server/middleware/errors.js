export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
export function errorHandler(err, req, res, next) {
  const validation = ['ValidationError', 'CastError', 'StrictModeError'].includes(err.name);
  const status = err.status || (validation ? 400 : err.code === 11000 ? 409 : 500);
  if (status === 500) console.error(err);
  const message = err.code === 11000 ? 'That email address or registration number is already in use.' :
    status === 500 ? 'Something went wrong. Please try again.' : err.message;
  res.status(status).json({ error: message });
}
