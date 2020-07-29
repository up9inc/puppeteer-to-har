import {Request, Response} from "puppeteer";

interface HARGeneratorOptions {
  disableEntriesSaveInMemory: boolean,
  onEntry?: (entry: Record<string, any>) => void
}

export default class HARGenerator {
  private requestTypeRegex = /\.(css|js|svg|png|jpg|jpeg|gif|ico|woff|woff2|map)/;
  private mimeTypeRegex = /((text\/css)|(image\/.*)|(application\/.*font.*)|(audio\/.*)|(video\/.*)|(font\/.*)|(application\/pdf)|(application\/ogg)|(text\/javascript)|(application\/.*javascript))/;
  private reqIdCookies: any = {};
  private reqIdTiming: any = {};
  private entries = [];
  options:HARGeneratorOptions = {
    disableEntriesSaveInMemory: false
  }

  constructor(options?: HARGeneratorOptions) {
    if (options) {
      this.options = {...this.options, ...options};
    }
  }

  private processRequestCookies(response: Response) {
    // @ts-ignore
    const requestId = response.request()._requestId;

    if (this.reqIdCookies[requestId]) {
      return this.reqIdCookies[requestId].map((cookie: any) => {
        cookie.expires = cookie.expires === -1 ? null : new Date(cookie.expires * 1000);
        return cookie;
      });
    }
    return [];
  }

  private processQueryString(request: any) {
    const query = require('url').parse(request.url(), true).query;
    return Object.keys(query).map(key => {
      return {
        name: key,
        value: query[key].toString() || ''
      };
    });
  }

  private processHeaders(headers: any) {
    return Object.keys(headers).map(key => {
      return {
        name: key,
        value: headers[key] || ''
      };
    });
  }

  private processResponseCookies(response: any) {
    if (response.headers()['set-cookie']) {
      return response.headers()['set-cookie'].split('\n').map((cookie: string) => {
        const cookieObj: Record<string, any> = {
          secure: false,
          httpOnly: false
        };

        cookie.split(';').forEach(((pair, idx) => {
          let [key, value] = pair.split('=');
          key = key.trim();

          if (idx === 0) {
            cookieObj.name = key;
            cookieObj.value = value;
          } else {
            const lowercasedKey = key.toLowerCase();

            switch (lowercasedKey) {
              case 'expires':
                if (!value || value === '-1') {
                  cookieObj.expires = null;
                } else {
                  cookieObj.expires = new Date(value).toISOString();
                }
                break;
              case 'secure':
                cookieObj.secure = true;
                break;
              case 'samesite':
                cookieObj.sameSite = value;
                break;
              case 'httponly':
                cookieObj.httpOnly = true;
                break;
              default:
                // All other keys - no special handling
                cookieObj[lowercasedKey] = value;
            }
          }
        }));

        return cookieObj;
      });
    }
    return [];
  }

  private processPostData(request: Request) {
    const mimeType = request.headers()['content-type'];
    const paramsArr = request.postData().split('&');
    const params = paramsArr.map((param: any) => {
      const splittedParam = param.split('=');
      return {name: splittedParam[0], value: splittedParam[1] || ''};
    });
    return {
      mimeType: mimeType,
      params: params,
      text: request.postData()
    };
  }

  private async processResponseText(response: Response) {
    try {
      const text = await response.text();
      return text;
    } catch (error) {
      return '';
    }
  }

  private buildHarEntry(timingsDiff: any, request: any, requestUrl: string, requestCookies: any, requestHeaders: any, queryString: any, response: any, responseCookies: any, responseHeaders: any, responseText: any, mimeType: string) {
    return {
      startedDateTime: new Date(),
      time: isNaN(timingsDiff) ? 0 : timingsDiff,
      request: {
        method: request.method(),
        url: requestUrl,
        httpVersion: '',
        cookies: requestCookies,
        headers: requestHeaders,
        queryString: queryString,
        headersSize: JSON.stringify(request.headers()).length,
        bodySize: request.postData() ? JSON.stringify(request.postData()).length : -1
      },
      response: {
        status: response.status(),
        statusText: response.statusText(),
        httpVersion: '',
        cookies: responseCookies,
        headers: responseHeaders,
        content: {
          size: Number(response.headers()['content-length']) || -1,
          compression: 0,
          mimeType: mimeType,
          text: Buffer.from(responseText).toString('base64'),
          encoding: 'base64'
        },
        redirectURL: response.headers().location || '',
        headersSize: JSON.stringify(response.headers()).length,
        bodySize: Number(response.headers()['content-length']) || -1
      },
      cache: {},
      timings: {
        send: -1,
        receive: isNaN(timingsDiff) ? -1 : timingsDiff,
        wait: -1
      }
    };
  }

  async handlePage(page: any) {
    await page.setRequestInterception(true);

    page.on('request', async (request: any) => {
      try {
        const cookies = await page.cookies(request.url());
        this.reqIdCookies[request._requestId] = cookies;
      } catch (error) {
      }
      this.reqIdTiming[request._requestId] = new Date();
      await request.continue();
    });

    page.on('response', async (response: any) => {
      const request = response.request();
      const requestUrl = request.url();
      const mimeType = response.headers()['content-type'] || '';
      if (requestUrl.match(this.requestTypeRegex) || mimeType.match(this.mimeTypeRegex)) {
        return;
      }
      // @ts-ignore
      const timingsDiff: number = Math.abs(new Date() - this.reqIdTiming[request._requestId]);
      const requestCookies = this.processRequestCookies(response);
      const responseCookies = this.processResponseCookies(response);
      const queryString = this.processQueryString(request);
      const requestHeaders = this.processHeaders(request.headers());
      const responseHeaders = this.processHeaders(response.headers());
      const responseText = await this.processResponseText(response);
      const entry = this.buildHarEntry(timingsDiff, request, requestUrl, requestCookies, requestHeaders, queryString, response, responseCookies, responseHeaders, responseText, mimeType);
      if ((request.method() === 'POST' || request.method() === 'PUT' || request.method() === 'PATCH') && request.postData()) {
        // @ts-ignore
        entry.request.postData = this.processPostData(request);
      }
      try {
        this.entries.push(entry);
        console.log(this.entries.length);
        this.options.onEntry?.(entry);
      } catch (error) {
        console.error(error);
      }
    });

  }

  toHarFormat() {
      return {
        log: {
          entries: this.entries,
          version: "1.2",
          creator: {
            "name": "UP9",
            "version": "1.0.0"
          }
        }
      }
  }


}
