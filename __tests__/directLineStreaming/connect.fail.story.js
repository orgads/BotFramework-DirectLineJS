import { ConnectionStatus } from '../../src/directLine';
import { DirectLineStreaming } from '../../src/directLineStreaming';
import waitFor from './__setup__/external/testing-library/waitFor';
import mockObserver from './__setup__/mockObserver';
import setupBotProxy from './__setup__/setupBotProxy';
import fetchToken from './__setup__/fetchToken';

jest.setTimeout(20000);

afterEach(() => jest.useRealTimers());

test('connect fail should signal properly', async () => {
  const retryDelayMs = 50;
  const retryDelayToleranceMs = 50;
  const originalGetRetryDelay = DirectLineStreaming.prototype.getRetryDelay;
  DirectLineStreaming.prototype.getRetryDelay = () => retryDelayMs;

  const onUpgrade = jest.fn();

  onUpgrade.mockImplementation((_req, socket) => {
    // Kill the socket when it tries to connect.
    socket.end();

    return Date.now();
  });

  try {
    const tokenResult = await fetchToken();
    if (!tokenResult) {
      console.warn('Skipping: Direct Line token service unavailable.');
      return;
    }

    const { domain, token } = tokenResult;

    const { directLineStreamingURL } = await setupBotProxy({ onUpgrade, streamingBotURL: new URL('/', domain).href });

    // GIVEN: A Direct Line Streaming chat adapter.
    const activityObserver = mockObserver();
    const connectionStatusObserver = mockObserver();
    const directLine = new DirectLineStreaming({ domain: directLineStreamingURL, token });

    directLine.connectionStatus$.subscribe(connectionStatusObserver);

    // ---

    // WHEN: Connect.
    const connectTime = Date.now();

    directLine.activity$.subscribe(activityObserver);

    // THEN: Should try to connect 3 times.
    await waitFor(() => expect(onUpgrade).toHaveBeenCalledTimes(3), { timeout: 5_000 });

    // THEN: Should not wait before connecting the first time.
    expect(onUpgrade.mock.results[0].value - connectTime).toBeLessThan(retryDelayMs);

    // THEN: Should wait for the retry delay before connecting the second time.
    expect(onUpgrade.mock.results[1].value - onUpgrade.mock.results[0].value).toBeGreaterThanOrEqual(retryDelayMs);
    expect(onUpgrade.mock.results[1].value - onUpgrade.mock.results[0].value).toBeLessThanOrEqual(
      retryDelayMs + retryDelayToleranceMs
    );

    // THEN: Should wait for the retry delay before connecting the third time.
    expect(onUpgrade.mock.results[2].value - onUpgrade.mock.results[1].value).toBeGreaterThanOrEqual(retryDelayMs);
    expect(onUpgrade.mock.results[2].value - onUpgrade.mock.results[1].value).toBeLessThanOrEqual(
      retryDelayMs + retryDelayToleranceMs
    );

    // THEN: Should observe "Uninitialized" -> "Connecting" -> "FailedToConnect".
    await waitFor(() =>
      expect(connectionStatusObserver).toHaveProperty('observations', [
        [expect.any(Number), 'next', ConnectionStatus.Uninitialized],
        [expect.any(Number), 'next', ConnectionStatus.Connecting],
        [expect.any(Number), 'next', ConnectionStatus.FailedToConnect]
      ])
    );

    // ---

    // WHEN: Call reconnect().
    const reconnectTime = Date.now();

    directLine.reconnect({
      conversationId: directLine.conversationId,
      token: directLine.token
    });

    // THEN: Should try to reconnect 3 times again.
    await waitFor(() => expect(onUpgrade).toHaveBeenCalledTimes(6));

    // THEN: Should not wait before reconnecting.
    //       This is because calling reconnect() should not by delayed.
    expect(onUpgrade.mock.results[3].value - reconnectTime).toBeLessThan(retryDelayMs);

    // THEN: Should wait for the retry delay before reconnecting the second time.
    expect(onUpgrade.mock.results[4].value - onUpgrade.mock.results[3].value).toBeGreaterThanOrEqual(retryDelayMs);
    expect(onUpgrade.mock.results[4].value - onUpgrade.mock.results[3].value).toBeLessThanOrEqual(
      retryDelayMs + retryDelayToleranceMs
    );

    // THEN: Should wait for the retry delay before reconnecting the third time.
    expect(onUpgrade.mock.results[5].value - onUpgrade.mock.results[4].value).toBeGreaterThanOrEqual(retryDelayMs);
    expect(onUpgrade.mock.results[5].value - onUpgrade.mock.results[4].value).toBeLessThanOrEqual(
      retryDelayMs + retryDelayToleranceMs
    );

    // THEN: Should observe "Uninitialized" -> "Connecting" -> "FailedToConnect" -> "Connecting" -> "FailedToConnect".
    await waitFor(() =>
      expect(connectionStatusObserver).toHaveProperty('observations', [
        [expect.any(Number), 'next', ConnectionStatus.Uninitialized],
        [expect.any(Number), 'next', ConnectionStatus.Connecting],
        [expect.any(Number), 'next', ConnectionStatus.FailedToConnect],
        [expect.any(Number), 'next', ConnectionStatus.Connecting],
        [expect.any(Number), 'next', ConnectionStatus.FailedToConnect]
      ])
    );
  } finally {
    DirectLineStreaming.prototype.getRetryDelay = originalGetRetryDelay;
  }
});
