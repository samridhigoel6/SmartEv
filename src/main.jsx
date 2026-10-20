import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import App from './App.jsx';
import { AuthProvider } from './Auth.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider><App/></AuthProvider></React.StrictMode>);
