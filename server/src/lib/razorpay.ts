import Razorpay from 'razorpay';

let client: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
  if (!client) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
    }
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}
