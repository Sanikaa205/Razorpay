import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { merchantRouter } from './routes/merchant';
import { productsRouter } from './routes/products';
import { UPLOADS_DIR } from './lib/uploads';

const app = express();
const port = process.env.PORT ?? 4000;
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/merchant', merchantRouter);
app.use('/api/products', productsRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
