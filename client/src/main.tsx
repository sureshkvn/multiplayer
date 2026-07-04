import { createRoot } from 'react-dom/client';
import { JoinScreen } from './JoinScreen.js';

createRoot(document.getElementById('root')!).render(<JoinScreen onJoin={() => {}} />);
