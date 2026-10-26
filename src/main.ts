import './style.css';
import { App } from './app';
import { loadArt } from './sprites';

loadArt().then(async () => {
  const app = new App();
  app.start();
  // Handy for poking at the sim from the console
  Object.assign(window, { app });
  if (import.meta.env.DEV) (await import('./devtools')).installDevtools(app);
});
