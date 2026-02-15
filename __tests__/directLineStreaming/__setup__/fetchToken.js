const DEFAULT_TOKEN_URL =
  'https://hawo-mockbot4-token-app.ambitiousflower-67725bfd.westus.azurecontainerapps.io/api/token/directlinease?bot=echo%20bot';

const TOKEN_URL = process.env.DIRECTLINE_TEST_TOKEN_URL || DEFAULT_TOKEN_URL;

export default async function fetchToken() {
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST' });

    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch {
    return null;
  }
}
