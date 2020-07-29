# Puppeteer to HAR
This module subscribes to a puppeteer page's `onResponse` callback and builds a HAR entry per request/response.

## Usage
```
import PuppeteerHARGenerator from "puppeteer-to-har";
const harGenerator = new PuppeteerHARGenerator({
    // Ideally used with the onEntry callback, you might not need to save all entries in memory
    disableEntriesSaveInMemory: false,
    // Optional callback to be called per generated entry
    onEntry: (harEntry) => {
        // Do some processing on an entry
    }
});

// Initialize puppeteer and get a page object 
...

// Run this for each page for which you want to monitor HTTP reqeuests/responses
harGenerator.attachPage(page);

// If the disableEntriesSaveInMemory wasn't set to true, you can call this at any point to generate a HAR file
harGenerator.generate();
``` 