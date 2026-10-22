import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/glass.css';
import './styles/shell.css';
import './styles/library.css';
import './styles/find.css';
import './styles/reader.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
