import { ConnectionStatus } from '../../src/directLine';
import { DirectLineStreaming } from '../../src/directLineStreaming';
import waitFor from './__setup__/external/testing-library/waitFor';
import mockObserver from './__setup__/mockObserver';
import setupBotProxy from './__setup__/setupBotProxy';
import fetchToken from './__setup__/fetchToken';

jest.setTimeout(15000);

afterEach(() => jest.useRealTimers());

test('should connect', async () => {
  const tokenResult = await fetchToken();
  if (!tokenResult) {
    console.warn('Skipping: Direct Line token service unavailable.');
    return;
  }

  const { domain, token } = tokenResult;

  const { directLineStreamingURL } = await setupBotProxy({ streamingBotURL: new URL('/', domain).href });

  // GIVEN: A Direct Line Streaming chat adapter.
  const activityObserver = mockObserver();
  const connectionStatusObserver = mockObserver();
  const directLine = new DirectLineStreaming({ domain: directLineStreamingURL, token });

  directLine.connectionStatus$.subscribe(connectionStatusObserver);

  // ---

  // WHEN: Connect.
  directLine.activity$.subscribe(activityObserver);

  // THEN: Should observe "Uninitialized" -> "Connecting" -> "Online".
  await waitFor(
    () =>
      expect(connectionStatusObserver).toHaveProperty('observations', [
        [expect.any(Number), 'next', ConnectionStatus.Uninitialized],
        [expect.any(Number), 'next', ConnectionStatus.Connecting],
        [expect.any(Number), 'next', ConnectionStatus.Online]
      ]),
    { timeout: 5000 }
  );

  // THEN: Should receive "Hello and welcome!"
  await waitFor(() =>
    expect(activityObserver).toHaveProperty('observations', [
      [expect.any(Number), 'next', expect.activityContaining('Hello and welcome!')]
    ])
  );
});
