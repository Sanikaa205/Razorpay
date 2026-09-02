import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { healthRouter } from './routes/health';

const app = express();
const port = process.env.PORT ?? 4000;

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
