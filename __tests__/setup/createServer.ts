/// <reference path="get-port.d.ts" />

import http from 'node:http';
import createDeferred from 'p-defer';
import getPort from 'get-port';

export type PlaybackWithDeferred = {
  deferred: createDeferred.DeferredPromise<{}>;
} & Playback;

export type Playback = {
  req: {
    method?: string;
    url?: string;
  };
  res: {
    body?: any;
    code?: number;
    headers?: any;
  };
};

export type CreateServerOptions = {
  playbacks: (Playback | Playback[])[];
};

export type CreateServerResult = {
  dispose: () => Promise<void>;
  port: number;
  promises: (Promise<{}> | Promise<{}>[])[];
};

export default async function (options: CreateServerOptions): Promise<CreateServerResult> {
  const port = await getPort({ port: 5000 });
  const server = http.createServer((req, res) => {
    const firstPlayback = orderedPlaybacks[0];

    if (!firstPlayback) {
      res.statusCode = 404;
      return res.end();
    }

    const unorderedPlaybacks = Array.isArray(firstPlayback) ? firstPlayback : [firstPlayback];
    let handled = false;

    unorderedPlaybacks.forEach(({ deferred, req: preq = {}, res: pres = {} }, index) => {
      if (req.url === (preq.url || '/')) {
        const origin = req.headers.origin || '*';

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader(
            'Access-Control-Allow-Methods',
            req.headers['access-control-request-method'] || 'GET'
          );
          res.setHeader(
            'Access-Control-Allow-Headers',
            req.headers['access-control-request-headers'] || ''
          );
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('');
          handled = true;
        } else if (req.method === (preq.method || 'GET')) {
          res.statusCode = pres.code || 200;
          res.setHeader('Access-Control-Allow-Origin', origin);

          if (typeof pres.body === 'string') {
            res.setHeader('Content-Type', 'text/plain');
          }

          if (pres.headers) {
            Object.entries(pres.headers).forEach(([key, value]) => res.setHeader(key, value as string));
          }

          if (typeof pres.body === 'undefined') {
            res.end();
          } else if (typeof pres.body === 'string' || Buffer.isBuffer(pres.body)) {
            res.end(pres.body);
          } else {
            res.end(JSON.stringify(pres.body));
          }

          handled = true;
          deferred.resolve();
          unorderedPlaybacks.splice(index, 1);

          if (!unorderedPlaybacks.length) {
            orderedPlaybacks.shift();
          }
        }

        return;
      }
    });

    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  const orderedPlaybacks: PlaybackWithDeferred[][] = (options.playbacks || []).map(unorderedPlaybacks => {
    if (Array.isArray(unorderedPlaybacks)) {
      return unorderedPlaybacks.map(playback => ({
        ...playback,
        deferred: createDeferred()
      }));
    } else {
      return [
        {
          ...unorderedPlaybacks,
          deferred: createDeferred()
        }
      ];
    }
  });

  server.listen(port);

  return {
    dispose: () => {
      return new Promise(resolve => server.close(resolve));
    },
    port,
    promises: options.playbacks.map((unorderedPlayback: Playback | Playback[], index) => {
      if (Array.isArray(unorderedPlayback)) {
        return (orderedPlaybacks[index] as PlaybackWithDeferred[]).map(({ deferred: { promise } }) => promise);
      } else {
        return orderedPlaybacks[index][0].deferred.promise;
      }
    })
  };
}
