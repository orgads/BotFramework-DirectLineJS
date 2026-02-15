try {
  require('global-agent/bootstrap');
} catch (error) {
  if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
    console.warn('global-agent bootstrap unavailable; proxy support disabled for tests.');
  }
}

// To use proxy, SET GLOBAL_AGENT_HTTP_PROXY=http://localhost:8888

const JSDOMEnvironment = require('jest-environment-jsdom').TestEnvironment;
const nodeFetch = globalThis.fetch;
const nodeHeaders = globalThis.Headers;
const nodeRequest = globalThis.Request;
const nodeResponse = globalThis.Response;
const nodeTextEncoder = globalThis.TextEncoder || require('node:util').TextEncoder;
const nodeTextDecoder = globalThis.TextDecoder || require('node:util').TextDecoder;
const nodeTransformStream = globalThis.TransformStream || require('node:stream/web').TransformStream;
const nodeReadableStream = globalThis.ReadableStream || require('node:stream/web').ReadableStream;
const nodeWritableStream = globalThis.WritableStream || require('node:stream/web').WritableStream;

class JSDOMEnvironmentWithProxy extends JSDOMEnvironment {
  setup() {
    if (nodeFetch && !this.global.fetch) {
      this.global.fetch = nodeFetch;
    }

    if (nodeHeaders && !this.global.Headers) {
      this.global.Headers = nodeHeaders;
    }

    if (nodeRequest && !this.global.Request) {
      this.global.Request = nodeRequest;
    }

    if (nodeResponse && !this.global.Response) {
      this.global.Response = nodeResponse;
    }

    if (nodeTextEncoder && !this.global.TextEncoder) {
      this.global.TextEncoder = nodeTextEncoder;
    }

    if (nodeTextDecoder && !this.global.TextDecoder) {
      this.global.TextDecoder = nodeTextDecoder;
    }

    if (nodeTransformStream && !this.global.TransformStream) {
      this.global.TransformStream = nodeTransformStream;
    }

    if (nodeReadableStream && !this.global.ReadableStream) {
      this.global.ReadableStream = nodeReadableStream;
    }

    if (nodeWritableStream && !this.global.WritableStream) {
      this.global.WritableStream = nodeWritableStream;
    }

    if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
      const { ResourceLoader } = require('jsdom');
      const resources = new ResourceLoader({ strictSSL: false });

      // HACK: We cannot set ResourceLoader thru testEnvironmentOptions.resources.
      //       This is because the ResourceLoader instance constructor is of "slightly" different type when on runtime (probably Jest magic).
      //       Thus, when we set it thru testEnvironmentOptions.resources, it will fail on "--watch" but succeed when running without watch.
      this.global._resourceLoader = resources;
    }

    return super.setup();
  }
}

module.exports = JSDOMEnvironmentWithProxy;
