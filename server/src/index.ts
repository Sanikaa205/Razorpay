import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { merchantRouter } from './routes/merchant';
import { productsRouter } from './routes/products';
import { storeAiRouter } from './routes/storeAi';
import { ordersRouter } from './routes/orders';
import { webhooksRouter } from './routes/webhooks';
import { UPLOADS_DIR } from './lib/uploads';

const app = express();
const port = process.env.PORT ?? 4000;
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));

// Razorpay webhook signature verification needs the raw request body, so this
// must be registered - with express.raw(), not express.json() - before the
// general JSON body parser below.
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));
app.use('/api/webhooks', webhooksRouter);

app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/merchant', merchantRouter);
app.use('/api/products', productsRouter);
app.use('/api/store-ai', storeAiRouter);
app.use('/api/orders', ordersRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
