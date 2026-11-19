import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app/App.js';
import { PwaUpdate } from './components/PwaUpdate.js';
import { appNavigation } from './shared/app-navigation.js';
import './styles.css';

appNavigation();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <PwaUpdate />
  </React.StrictMode>,
);
