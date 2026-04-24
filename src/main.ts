import { startApp } from './app';

const canvas = document.querySelector<HTMLCanvasElement>('#c');
const hud = document.querySelector<HTMLElement>('#hud');
if (!canvas || !hud) throw new Error('missing required DOM nodes');
startApp(canvas, hud);
