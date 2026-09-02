import fs from 'fs';
import path from 'path';

export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
