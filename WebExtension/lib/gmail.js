'use strict';

var gmail = {};

/*gmail.fetch = url => fetch(url, {
  credentials: 'same-origin',
  mode: 'cors',
  headers:{
    'Access-Control-Allow-Origin': '*'
  }
}).then(r => {
  console.log(url, r);
  if (r.ok) {
    return r;
  }
  throw Error('action -> fetch Error');
});*/
gmail.fetch = url => new Promise((resolve, reject) => {
  const req = new XMLHttpRequest();
  req.onload = () => resolve({
    text: () => req.response,
    status: req.status
  });
  req.onerror = () => reject(new Error('action -> fetch Error'));
  req.open('GET', url);
  req.send();
});

gmail.random = () => (Math.random().toString(36) + '00000000000000000').slice(2, 14);

gmail.get = {
  base: url => /[^?]*/.exec(url)[0].split('/h')[0].replace(/\/$/, ''),
  id: url => {
    const tmp = /message_id=([^&]*)/.exec(url);
    if (tmp && tmp.length) {
      return tmp[1];
    }
    return null;
  }
};

{
  const token = {};
  gmail.at = {};
  gmail.at.get = url => {
    url = gmail.get.base(url);
    if (token[url]) {
      return Promise.resolve(token[url]);
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({
        inboxRedirection: true
      }, prefs => {
        if (prefs.inboxRedirection) {
          url += '/?ibxr=0';
        }
        gmail.fetch(url).then(r => r.text()).then(content => {
          const at = /GM_ACTION_TOKEN="([^"]*)"/.exec(content || '');
          const ik = /var GLOBALS=\[(?:([^,]*),){10}/.exec(content || '');
          token[url] = {
            at: at && at.length ? at[1] : '',
            ik: ik && ik.length ? ik[1].replace(/["']/g, '') : ''
          };

          if (token[url].at === '') {
            new Error('action -> Cannot resolve GM_ACTION_TOKEN');
          }
          if (token[url].ik === '') {
            new Error('action -> Cannot resolve GLOBALS');
          }

          return token[url];
        }).then(resolve, reject);
      });
    });
  };
  gmail.at.invalidate = url => delete token[gmail.get.base(url)];
}

gmail.formData = (obj) => {
  const arr = [];
  Object.keys(obj).forEach(key => {
    if (!Array.isArray(obj[key])) {
      obj[key] = [obj[key]];
    }
    obj[key].forEach(v => {
/*      if (key === 'q') {
        v = v.replace(/\s/, '+');
      }*/
      arr.push(`${key}=${encodeURIComponent(v)}`);
    });
  });
  return arr.join('&');
};

gmail.post = (url, params, threads = [], retry = true, express = false) => new Promise((resolve, reject) => {
  const req = new XMLHttpRequest();
  chrome.storage.local.get({
    inboxRedirection: true,
    express: false
  }, prefs => {
    url = (gmail.get.base(url) + (prefs.inboxRedirection ? '/?ibxr=0&' : '/?') + gmail.formData(params));
    req.open('POST', url);
    req.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
    req.onreadystatechange = () => {
      // consider post as successful if req.readyState === HEADERS_RECEIVED
      if (express && prefs.express && req.readyState === 2 && req.status === 200) {
        resolve(req);
      }
    };
    req.onload = () => {
      if (req.status === 302 && retry === true) {
        gmail.at.invalidate(url);
        console.log('retrying');
        gmail.post(url, params, threads, retry = false).then(resolve, reject);
      }
      else if (req.status === 404) {
        reject(new Error('Gmail is rejecting this action'));
      }
      else {
        resolve(req);
      }
    };
    req.onerror = () => reject('');
    req.send(threads.length ? 't=' + threads.join('&t=') : '');
  });
});

{
  function sendCmd(url, at, ik, threads, act) {
    if (act === 'rc_%5Ei') {
      // mark as read on archive
      chrome.storage.local.get({
        doReadOnArchive: false
      }, prefs => {
        if (prefs.doReadOnArchive === true || prefs.doReadOnArchive === 'true') {
          gmail.post(url, {
            ui: 2,
            ik,
            at,
            act: 'rd'
          }, threads);
        }
      });
    }
    return gmail.post(url, {
      ui: 2,
      ik,
      at,
      act
    }, threads, true, true);
  }

  gmail.action = ({links, cmd}) => {
    if (cmd === 'rc_Inbox' || cmd === 'rd-all') {
      // remove label Inbox
      cmd = 'rc_^i';
    }
    else if (cmd === 'rc_Spam') {
      cmd = 'us';
    }
    links = typeof links === 'string' ? [links] : links;
    const url = /[^?]*/.exec(links[0])[0];

    return gmail.at.get(url).then(obj => {
      const threads = links.map(link => gmail.get.id(link) || '').map(t => t);

      if (threads.length) {
        return sendCmd(url, obj.at, obj.ik, threads, cmd);
      }
      return Promise.reject(Error('action -> Error at resolving thread.'));
    });
  };
}

gmail.search = ({url, query}) => gmail.at.get(url).then(({at, ik}) => gmail.post(url, {
  ui:2,
  ik,
  at,
  view: 'tl',
  start: 0,
  num: 55,
  rt: 'c',
  q: query,
  qs: true,
  search: 'query'
}).then(r => {
  const json = JSON.parse(r.response.split('\n')[5]);
  return json[0][2].map(o => ({
    thread: o[1],
    labels: o[5],
    date: o[16],
    hdate: o[15],
    from: o[28],
    text: o[9],
    html: o[10]
  }));
}));
