import DashGov from "dashgov";

// import DashKeys from "dashkeys";
// import DashTx from "dashtx";

//@ts-expect-error
let Secp256k1 = window.nobleSecp256k1;
//@ts-expect-error
let DashKeys = window.DashKeys;
//@ts-expect-error
let DashTx = window.DashTx;

//@ts-expect-error
let QRCode = window.QRCode;

let ProposalApp = {};

const MAINNET = "mainnet";

ProposalApp.network = MAINNET;
ProposalApp.rpcUrl = `https://api:null@rpc.digitalcash.dev/`;
ProposalApp.customRpcUrl = "";

ProposalApp.mainnet = {
  initialized: false,
  blockDelta: 0,
  checkpoint: {
    block: 0,
    ms: 0,
  },
  snapshot: {
    block: 0,
    ms: 0,
  },
  secondsPerBlock: 0.0,
};

ProposalApp.testnet = {
  initialized: false,
  blockDelta: 0,
  checkpoint: {
    block: 0,
    ms: 0,
  },
  snapshot: {
    block: 0,
    ms: 0,
  },
  secondsPerBlock: 0.0,
};

ProposalApp.utxos = [
  {
    satoshis: 0,
  },
];

/**
 * @param {String} method
 * @param {...any} params
 */
ProposalApp.rpc = async function (method, ...params) {
  let rpcBaseUrl = ProposalApp.customRpcUrl;
  if (rpcBaseUrl.length === 0) {
    if (ProposalApp.network === MAINNET) {
      rpcBaseUrl = `https://api:null@rpc.digitalcash.dev/`;
    } else {
      rpcBaseUrl = `https://api:null@trpc.digitalcash.dev/`;
    }
  }

  let result = await DashTx.utils.rpc(rpcBaseUrl, method, ...params);
  return result;
};

/**
 * @param {"mainnet"|"testnet"|String} _network
 */
ProposalApp.$setNetwork = async function (_network) {
  if (_network === MAINNET) {
    ProposalApp.network = MAINNET;
  } else {
    ProposalApp.network = "testnet";
  }

  await ProposalApp.init();
};

ProposalApp.$updateRpcUrl = async function () {
  //@ts-expect-error
  let customRpcUrl = document.querySelector("[name=rpcUrl]").value;

  let canParse = URL.canParse(customRpcUrl);
  if (!canParse) {
    ProposalApp.customRpcUrl = "";
    return;
  }
  ProposalApp.customRpcUrl = customRpcUrl;

  let networkInfo = ProposalApp.testnet;
  if (ProposalApp.network === MAINNET) {
    networkInfo = ProposalApp.mainnet;
  }
  networkInfo.initialized = false;
  await ProposalApp.init();
};

ProposalApp.$parse = function () {
  /** @type {HTMLFormElement} */ //@ts-expect-error
  let $form = document.querySelector("#proposal-form");
  let formData = new FormData($form);

  /** @type {any} */
  let values = Object.fromEntries(formData);
  let index = parseInt(values.index || "1", 10);
  let count = parseInt(values.count || "1", 10);
  let paymentAmount = parseInt(values.paymentAmount || "1", 10);
  let wif = values.burnWif;

  let networkInfo = ProposalApp.testnet;
  if (ProposalApp.network === MAINNET) {
    networkInfo = ProposalApp.mainnet;
  }

  let offset = count - 1;
  let end = index + offset;

  let estimates = DashGov.estimateProposalCycles(
    end,
    networkInfo.snapshot,
    networkInfo.secondsPerBlock,
  );
  let selection = DashGov.selectEstimates(estimates, index, end);

  let name = values.proposalName;
  let paymentAddress = values.paymentAddress;
  let url = values.proposalUrl;

  return {
    networkInfo,
    selection,
    index,
    count,
    offset,
    end,
    name,
    paymentAddress,
    paymentAmount,
    url,
    wif,
  };
};

ProposalApp.$restore = async function () {
  let oldWif = dbGet(`wif-${ProposalApp.network}-latest`);
  if (!oldWif) {
    oldWif = await DashKeys.utils.generateWifNonHd();
    dbSet(`wif-${ProposalApp.network}-latest`, oldWif);
  }

  let burnAddr = await DashKeys.wifToAddr(oldWif, {
    version: ProposalApp.network,
  });
  dbSet(`wif-${ProposalApp.network}-${burnAddr}`, oldWif);

  let addrQr = new QRCode({
    content: `dash:${burnAddr}?amount=1.00000250`,
    padding: 4,
    width: 256,
    height: 256,
    color: "#000000",
    background: "#ffffff",
    ecl: "M",
  });
  let addrSvg = addrQr.svg();
  let oldDraft = dbGet(`submission-latest`);

  //@ts-expect-error
  document.querySelector('[name="burnWif"]').type = "password";
  //@ts-expect-error
  document.querySelector("[data-id=burnAddr]").textContent = burnAddr;

  //@ts-expect-error
  document.querySelector("[data-id=addressQr").innerHTML = addrSvg;

  //@ts-expect-error
  document.querySelector('[name="burnWif"]').value = oldWif;
  void ProposalApp.$checkBalance();

  if (!oldDraft?.gobjData?.count) {
    return;
  }

  //@ts-expect-error
  document.querySelector("[name=index]").value = oldDraft.index;
  //@ts-expect-error
  document.querySelector("[name=count]").value = oldDraft.count;
  //@ts-expect-error
  document.querySelector("[name=proposalName]").value = oldDraft.gobjData.name;
  //@ts-expect-error
  document.querySelector("[name=proposalUrl]").value = oldDraft.gobjData.url;
  //@ts-expect-error
  document.querySelector("[name=paymentAddress]").value =
    oldDraft.gobjData.payment_address;
  //@ts-expect-error
  document.querySelector("[name=paymentAmount]").value =
    oldDraft.gobjData.payment_amount;
};

ProposalApp.$total = async function () {
  let proposal = ProposalApp.$parse();
  if (
    isNaN(proposal.paymentAmount) ||
    isNaN(proposal.index) ||
    isNaN(proposal.count)
  ) {
    return;
  }

  let displayCount = 18;
  let displayEnd = proposal.index + proposal.count; // 1 extra
  displayEnd = Math.max(displayCount, displayEnd);

  let estimates = DashGov.estimateProposalCycles(
    displayEnd,
    proposal.networkInfo.snapshot,
    proposal.networkInfo.secondsPerBlock,
  );

  logRows(estimates);

  let previewParams = Object.assign(proposal, {
    displayCount: 18,
    estimates: estimates,
  });
  await ProposalApp._$renderDeadlines(previewParams);

  await ProposalApp.$draftJSON();
};

let msToDays = 24 * 60 * 60 * 1000;
let msToHours = 60 * 60 * 1000;

/**
 * @typedef DeadlineParams
 * @prop {import('dashgov').Selection} selection - The start and end epoch info.
 * @prop {import('dashgov').Estimates} estimates
 * @prop {Number} index - The start period for the proposal.
 * @prop {Number} count - Number of periods for which the proposal applies.
 * @prop {Number} paymentAmount - The amount of Dash for the proposal.
 */

/**
 * @param {DeadlineParams} opts
 */
ProposalApp._$renderDeadlines = async function ({
  selection,
  estimates,
  index,
  count,
  paymentAmount,
}) {
  /* jshint maxcomplexity: 100 */
  /* jshint maxstatements: 1000 */

  // TODO this is only for testing XXX
  if (false) {
    if (!estimates.lameduck) {
      //@ts-expect-error
      estimates.lameduck = estimates.upcoming.shift();
    }
  }

  requestAnimationFrame(function () {
    let offset = count - 1;
    renderRows(index, offset, estimates);
    setTimeout(function () {
      requestAnimationFrame(function () {
        $scrollToFirstSelected();
      });
    }, 200);
    renderSummary({ count, paymentAmount, selection });
  });
};

function $scrollToFirstSelected() {
  /** @type {HTMLElement} */ //@ts-expect-error
  let $container = document.querySelector(".table-container");
  /** @type {HTMLElement} */ //@ts-expect-error
  let $firstSelectedRow = document.querySelector("tr.selected");

  if ($firstSelectedRow) {
    // Scroll the container so the target row is in view
    let topPosition = 50 + $firstSelectedRow.offsetTop + -$container.offsetTop;
    $container.scrollTo({
      top: topPosition,
      behavior: "smooth",
    });
  }
}

ProposalApp.$draftJSON = async function () {
  let proposal = ProposalApp.$parse();
  if (
    isNaN(proposal.paymentAmount) ||
    isNaN(proposal.index) ||
    isNaN(proposal.count)
  ) {
    return;
  }

  let gobjData = DashGov.proposal.draftJson(proposal.selection, {
    name: proposal.name,
    payment_address: proposal.paymentAddress,
    payment_amount: proposal.paymentAmount,
    url: proposal.url,
  });

  let gobjJSON = JSON.stringify(gobjData, null, 2);
  //@ts-expect-error
  document.querySelector('[data-id="json"]').textContent = gobjJSON;

  {
    let startMs = gobjData.start_epoch * 1000;
    let startDate = new Date(startMs);
    let start = startDate.toISOString();
    start = start.replace("T", " ");
    start = start.replace(/:\d\d\.\d{3}Z/, "");

    let endMs = gobjData.end_epoch * 1000;
    let endDate = new Date(endMs);
    let end = endDate.toISOString();
    end = end.replace("T", " ");
    end = end.replace(/:\d\d\.\d{3}Z/, " UTC");

    //@ts-expect-error
    document.querySelector('[data-id="epochs"]').textContent =
      `valid ${start} - ${end}`;
  }

  // ProposalApp.draft({
  //   selection: selection,
  //   paymentAmount: paymentAmount,
  //   url: values.url,
  //   name: values.name,
  //   paymentAddress: values.paymentAddress,
  //   wif: values.burnWif,
  // });
};

ProposalApp.$checkBalance = async function () {
  let proposal = ProposalApp.$parse();

  let burnAddr = await DashKeys.wifToAddr(proposal.wif, {
    version: ProposalApp.network,
  }).catch(Object);
  if (burnAddr instanceof Error) {
    ProposalApp.utxos = [
      {
        satoshis: 0,
      },
    ];
    //@ts-expect-error
    document.querySelector('[data-id="wifinfo"]').textContent = "";
    return;
  }

  let addrQr = new QRCode({
    content: `dash:${burnAddr}?amount=1.00000250`,
    padding: 4,
    width: 256,
    height: 256,
    color: "#000000",
    background: "#ffffff",
    ecl: "M",
  });
  let addrSvg = addrQr.svg();
  //@ts-expect-error
  document.querySelector("[data-id=addressQr").innerHTML = addrSvg;

  let sweepQr = new QRCode({
    content: `dash:${proposal.wif}`,
    padding: 4,
    width: 384,
    height: 384,
    color: "#000000",
    background: "#ffffff",
    ecl: "M",
  });
  let sweepSvg = sweepQr.svg();
  //@ts-expect-error
  document.querySelector("[data-id=sweepQr").innerHTML = sweepSvg;
  //@ts-expect-error
  document.querySelector("[data-id=sweepWif").textContent = proposal.wif;

  if (ProposalApp.utxos?.[0]?.satoshis) {
    //@ts-expect-error
    document.querySelector('[data-id="wifinfo"]').textContent = "";
    return;
  }

  // the human eye often can't even perceive changes that take less than 100ms
  const MIN_VISUAL_TIME = 100;
  // and the brain needs about 250ms to process what it has perceived
  const MIN_COMPREHENSION_TIME = 250;

  setTimeout(function () {
    //@ts-expect-error
    document.querySelector('[data-id="wifinfo"]').textContent = "";
    //@ts-expect-error
    document.querySelector('[data-id="wiftotal"]').textContent = `checking...`;
  }, MIN_VISUAL_TIME);

  ProposalApp.utxos = await ProposalApp.rpc("getaddressutxos", {
    addresses: [burnAddr],
  });

  setTimeout(function () {
    let utxosJSON = JSON.stringify(ProposalApp.utxos, null, 2);
    //@ts-expect-error
    document.querySelector('[data-id="wifinfo"]').textContent = utxosJSON;

    let total = DashTx.sum(ProposalApp.utxos);
    let amountF = total / DashTx.SATOSHIS;
    amountF = amountF * 1000;
    amountF = Math.floor(amountF);
    amountF = amountF / 1000;

    let dust = total % 100000;

    let amount = amountF.toFixed(3);
    //@ts-expect-error
    document.querySelector('[data-id="wiftotal"]').textContent =
      `${amount} DASH + ${dust} dust`;
  }, MIN_VISUAL_TIME + MIN_COMPREHENSION_TIME);
};

/**
 * @param {SubmitEvent} event
 */
ProposalApp.$submit = async function (event) {
  event.preventDefault();

  let proposal = ProposalApp.$parse();
  if (!proposal.wif) {
    throw new Error(`missing "collateral" WIF`);
  }

  let burnAddr = await DashKeys.wifToAddr(proposal.wif, {
    version: ProposalApp.network,
  });

  console.log("");
  console.log("Burn Address (source of 1 DASH network fee):");
  console.log(burnAddr);

  let utxos = await ProposalApp.rpc("getaddressutxos", {
    addresses: [burnAddr],
  });
  let proposalDraft = Object.assign(proposal, { utxos });

  let draft = await ProposalApp.draft(proposalDraft);
  // {
  //   tx: txInfoSigned,
  //   txid: txid,
  //   gobj: gobj,
  //   gobjid: gobjid,
  //   _gobjIdLittleEndian: gobjidLittleEndian,
  // }

  //@ts-expect-error
  document.querySelector('[data-id="txid"]').textContent = draft.txid;
  //@ts-expect-error
  document.querySelector('[data-id="txhex"]').textContent =
    draft.tx.transaction;
  //@ts-expect-error
  document.querySelector('[data-id="txjson"]').textContent = JSON.stringify(
    draft.tx,
    null,
    2,
  );
  //@ts-expect-error
  document.querySelector('[data-id="gobjid"]').textContent = draft.gobjid;
  //@ts-expect-error
  document.querySelector('[data-id="gobjhex"]').textContent =
    draft.gobj.dataHex;
  //@ts-expect-error
  document.querySelector('[data-id="gobjjson"]').textContent = JSON.stringify(
    draft.gobj,
    null,
    2,
  );

  /** @type {HTMLInputElement?} */ //@ts-expect-error
  let $button = event.submitter;
  if ($button?.value !== "submit") {
    await mustValidateGobj(draft.gobj);
    window.alert("Passed MN Validation");
    return;
  }

  let sameDraft = dbGet(`submission-${draft.gobjid}`);
  if (!sameDraft) {
    sameDraft = Object.assign(draft, {
      index: proposalDraft.index,
      count: proposalDraft.count,
    });
    dbSet(`submission-${draft.gobjid}`, sameDraft);
    dbSet("submission-latest", sameDraft);
  }
  draft = sameDraft;

  let doIt = window.confirm(
    `Submission will take several minutes (a few confirmations).\n` +
      `(data will be backed up in localStorage for automatic recovery).\n` +
      `\nStart now?\n`,
  );
  if (!doIt) {
    return;
  }

  //@ts-expect-error
  document.querySelector(`[data-id="log"]`).hidden = false;
  await ProposalApp._$fullSubmit(draft);

  window.alert(
    `Sucess!\nIt may take a few hours to show up on Dash Central, etc.`,
  );
  dbSet(`wif-${ProposalApp.network}-latest`, "");
};

/**
 * @param {String} key
 * @param {any?} [defVal]
 */
function dbGet(key, defVal) {
  let dataJson = localStorage.getItem(key);
  if (!dataJson) {
    dataJson = JSON.stringify(defVal);
  }

  let data;
  try {
    data = JSON.parse(dataJson);
  } catch (e) {
    data = defVal;
  }
  return data;
}

/**
 * @param {String} key
 * @param {any} val
 */
function dbSet(key, val) {
  if (val === null) {
    localStorage.removeItem(key);
    return;
  }

  let dataJson = JSON.stringify(val);
  localStorage.setItem(key, dataJson);
}

/**
 * @param {import('dashgov').GObject} gobj
 */
async function mustValidateGobj(gobj) {
  let gobjResult = await ProposalApp.rpc(
    "gobject",
    "check",
    gobj.dataHex,
  ).catch(
    /** @param {any} err */ function (err) {
      console.error(err.message);
      console.error(err.code);
      console.error(err);
      // invalid burn hash
      return { error: err.message || err.stack || err.toString() };
    },
  );

  // { result: { 'Object status': 'OK' }, error: null, id: 5542 }
  if (gobjResult?.["Object status"] !== "OK") {
    throw new Error(`gobject failed: ${gobjResult?.error}`);
  }
}

ProposalApp.init = async function () {
  // TODO: restore from localStorage

  let networkInfo = ProposalApp.testnet;
  if (ProposalApp.network === MAINNET) {
    networkInfo = ProposalApp.mainnet;
  }

  if (networkInfo.initialized) {
    return;
  }

  let tipsResult = await ProposalApp.rpc("getbestblockhash");
  let blockInfoResult = await ProposalApp.rpc("getblock", tipsResult, 1);
  let blockHeight = blockInfoResult.height;
  let blockMs = blockInfoResult.time * 1000;
  // console.log(rootInfoResult, blockInfoResult, blockMs);
  // let blockTime = new Date(blockMs);

  networkInfo.blockDelta = 25000; // chosen due to testnet gaps

  let rootHeight = blockInfoResult.height - networkInfo.blockDelta;
  let rootResult = await ProposalApp.rpc("getblockhash", rootHeight);
  let rootInfoResult = await ProposalApp.rpc("getblock", rootResult, 1);

  networkInfo.checkpoint = {
    block: rootHeight,
    ms: rootInfoResult.time * 1000,
  };

  networkInfo.snapshot = {
    block: blockHeight,
    ms: blockMs,
  };

  networkInfo.secondsPerBlock = DashGov.measureSecondsPerBlock(
    networkInfo.snapshot,
    networkInfo.checkpoint,
  );

  networkInfo.initialized = true;

  console.info();
  console.info(
    `Current Seconds per Block (last ${networkInfo.blockDelta} blocks):`,
    networkInfo.secondsPerBlock,
  );
};

/**
 * @typedef SummaryParams
 * @prop {Number} count
 * @prop {Number} paymentAmount
 * @prop {import('dashgov').Selection} selection - The start and end epoch info.
 */

/**
 * @param {SummaryParams} opts
 */
function renderSummary({ count, paymentAmount, selection }) {
  let proposalDeltaStr = toDaysStr(
    selection.start.startMs,
    selection.start.endMs,
  );
  let voteDeltaStr = toDaysStr(selection.start.startMs, selection.start.voteMs);
  let paymentDeltaStr = toDaysStr(
    selection.start.superblockMs,
    selection.end.superblockMs,
  );
  let totalDash = count * paymentAmount;
  //@ts-expect-error
  document.querySelector('[data-id="total"]').textContent = totalDash;

  console.log("");
  console.log(
    `Proposal Period: ${selection.start.startIso} - ${selection.end.endIso} (~${proposalDeltaStr} days)`,
  );
  console.log(
    `Vote Period:     ${selection.start.startIso} - ${selection.end.voteIso} (~${voteDeltaStr} days)`,
  );
  console.log(
    `Payment Period:  ${selection.start.superblockIso} - ${selection.end.superblockIso} (~${paymentDeltaStr} days)`,
  );
  console.log("");
  console.log(`Total Dash: ${totalDash} = ${paymentAmount} x ${count}`);
}

/**
 * @param {Number} startMs
 * @param {Number} endMs
 */
function toDaysStr(startMs, endMs) {
  let deltaMs = endMs - startMs;
  let deltaDays = deltaMs / msToDays;
  let deltaDaysStr = deltaDays.toFixed(1);
  return deltaDaysStr;
}

/**
 * @param {Number} index
 * @param {Number} offset
 * @param {import('dashgov').Estimates} estimates
 */
function renderRows(index, offset, estimates) {
  let end = index + offset;

  /** @type {HTMLElement} */ //@ts-expect-error
  let $tbody = document.querySelector('[data-id="dates"]');
  // $tbody.textContent = "";

  /** @type {HTMLTemplateElement} */ //@ts-expect-error
  let $template = document.querySelector('[data-id="dates-tmpl"]');
  let $tbodyFragment = document.createDocumentFragment();

  if (estimates.lameduck) {
    /** @type {HTMLElement} */ //@ts-expect-error
    let $trFrag = $template.content.cloneNode(true);
    /** @type {HTMLTableRowElement} */ //@ts-expect-error
    let $tr = $trFrag.querySelector("tr");

    renderRow($tr, estimates.lameduck, 0);
    //@ts-expect-error
    $tr.querySelector('[data-name="index"]').textContent = "0 ⚠️";
    $tr.classList.add("lameduck");
    if (0 >= index && 0 <= end) {
      $tr.classList.add("selected");
    }
    $tbodyFragment.appendChild($tr);
    // console.log(0, $tbodyFragment);
    // $tbody.appendChild($tr);
  }

  let i = 0;
  for (let estimate of estimates.upcoming) {
    i += 1;
    /** @type {HTMLElement} */ //@ts-expect-error
    let $trFrag = $template.content.cloneNode(true);
    /** @type {HTMLTableRowElement} */ //@ts-expect-error
    let $tr = $trFrag.querySelector("tr");

    renderRow($tr, estimate, i);
    if (i >= index && i <= end) {
      $tr.classList.add("selected");
    }
    $tbodyFragment.appendChild($tr);
    // console.log(i, $tbodyFragment);
    // $tbody.appendChild($tr);
  }

  $tbody.replaceChildren($tbodyFragment);
  // console.log("all", $tbodyFragment);
}

/**
 * @param {HTMLTableRowElement} $tr
 * @param {import('dashgov').Estimate} estimate
 * @param {Number} i
 */
function renderRow($tr, estimate, i) {
  //@ts-expect-error
  $tr.querySelector('[data-name="index"]').textContent = i.toString();

  {
    let round = null;
    let [submitLocale] = getTimeStrings(estimate.startIso, 0, i, round);
    //@ts-expect-error
    $tr.querySelector('[data-name="start"]').innerHTML =
      `${submitLocale}<br>&nbsp;`;
  }

  {
    let floor = false;
    let [voteLocale, voteRelative] = getTimeStrings(
      estimate.voteIso,
      estimate.voteDeltaMs,
      i,
      floor,
    );
    //@ts-expect-error
    $tr.querySelector('[data-name="vote"]').innerHTML =
      `${voteLocale}<br>~${voteRelative} (${estimate.voteDelta} blocks)`;
  }

  {
    let ceil = true;
    let [paymentLocale, paymentRelative] = getTimeStrings(
      estimate.superblockIso,
      estimate.superblockDeltaMs,
      i,
      ceil,
    );
    //@ts-expect-error
    $tr.querySelector('[data-name="payment"]').innerHTML =
      `${paymentLocale}<br>~${paymentRelative} (${estimate.superblockDelta} blocks)`;
  }
}

/**
 * @param {String} isoTime
 * @param {Number} deltaMs
 * @param {Number} i
 * @param {Boolean?} _round - true ceil, null round, false floor
 */
function getTimeStrings(isoTime, deltaMs, i, _round) {
  let d = new Date(isoTime);
  void roundToQuarterHour(d, _round);

  let localeTime = d.toLocaleString();
  // TODO round to the nearest 15m
  localeTime = localeTime.replace(/:\d\d /, " ");

  let relativeTime;
  if (i === 0) {
    let hours = deltaMs / msToHours;
    let hoursStr = hours.toFixed(2);
    relativeTime = `${hoursStr} <strong><em>hours</em></strong>`;
  } else {
    let days = deltaMs / msToDays;
    let daysStr = days.toFixed(2);
    relativeTime = `${daysStr} days`;
  }

  return [localeTime, relativeTime];
}

/**
 * Rounds an ISO timestamp to the nearest 15 minutes.
 * @param {Date} date
 * @param {Boolean?} _round - true ceil, null round, false floor
 */
function roundToQuarterHour(date, _round) {
  let minutes = date.getMinutes();
  let quarterHourF = minutes / 15;

  if (_round === true) {
    quarterHourF = Math.ceil(quarterHourF);
  } else if (_round === false) {
    quarterHourF = Math.floor(quarterHourF);
  } else {
    quarterHourF = Math.round(quarterHourF);
  }

  let roundedMinutes = quarterHourF * 15;
  if (roundedMinutes === 60) {
    date.setHours(date.getHours() + 1);
    date.setMinutes(0);
  } else {
    date.setMinutes(roundedMinutes);
  }

  date.setSeconds(0);
  date.setMilliseconds(0);
}

/**
 * @param {import('dashgov').Estimates} estimates
 */
function logRows(estimates) {
  console.info("");
  console.info("VOTING PERIODS");

  if (estimates.lameduck) {
    logRow(estimates.lameduck, 0);
  }

  let i = 0;
  for (let estimate of estimates.upcoming) {
    i += 1;
    logRow(estimate, i);
  }
}

/**
 * @param {import('dashgov').Estimate} estimate
 * @param {Number} i
 */
function logRow(estimate, i) {
  let log = console.info;
  if (i === 0) {
    log = console.error;
  }
  log(``);

  {
    let startEpochTime = new Date(estimate.startMs);
    let startEpochLocale = startEpochTime.toLocaleString();
    startEpochLocale = startEpochLocale.padEnd(23, " ");
    if (i === 0) {
      log(`0: Lame duck (new proposals will be too late to pass):`);
    } else {
      log(`${i}:  Start   | ${startEpochLocale} |   ${estimate.startIso}`);
    }
  }

  let v = new Date(estimate.voteIso);
  let voteLocaleTime = v.toLocaleString();
  voteLocaleTime = voteLocaleTime.padEnd(23, " ");
  let days = estimate.voteDeltaMs / msToDays;
  let daysStr = days.toFixed(2);
  daysStr = `${daysStr} days`;
  if (i === 0) {
    let hours = estimate.voteDeltaMs / msToHours;
    let hoursStr = hours.toFixed(2);
    daysStr = `${hoursStr} hours`;
  }
  log(
    `    Vote    | ${voteLocaleTime} | ${estimate.voteDelta} blocks | ~${daysStr}`,
  );

  let d = new Date(estimate.superblockIso);
  let superblockLocaleTime = d.toLocaleString();
  superblockLocaleTime = superblockLocaleTime.padEnd(23, " ");
  days = estimate.superblockDeltaMs / msToDays;
  daysStr = days.toFixed(2);
  daysStr = `${daysStr} days`;
  if (i === 0) {
    let hours = estimate.superblockDeltaMs / msToHours;
    let hoursStr = hours.toFixed(2);
    daysStr = `${hoursStr} hours`;
  }
  log(
    `    Payment | ${superblockLocaleTime} | ${estimate.superblockDelta} blocks | ~${daysStr}`,
  );

  {
    let endEpochTime = new Date(estimate.endMs);
    let endEpochLocale = endEpochTime.toLocaleString();
    endEpochLocale = endEpochLocale.padEnd(23, " ");
    log(`    End     | ${endEpochLocale} |   ${estimate.endIso}`);
  }
}

/**
 * @typedef SignTxParams
 * @prop {String} wif
 * @prop {Array<any>} utxos
 * @prop {Hex} gobjidLittleEndian
 */

/**
 * @param {SignTxParams} opts
 */
ProposalApp.signBurnTx = async function ({ wif, utxos, gobjidLittleEndian }) {
  // /** @type {Array<DashTx.TxInput>} */
  let inputs = utxos;

  // @type {Array<DashTx.TxOutput>} */
  let outputs = [{ memo: gobjidLittleEndian, satoshis: 100000000 }];
  let txInfo = { inputs, outputs };

  let keyUtils = {
    /**
     * @param {import('dashtx').TxInputForSig} txInput
     * @param {Number} [i]
     */
    getPrivateKey: async function (txInput, i) {
      return DashKeys.wifToPrivKey(wif, { version: ProposalApp.network });
    },

    /**
     * @param {import('dashtx').TxInputForSig} txInput
     * @param {Number} [i]
     */
    getPublicKey: async function (txInput, i) {
      let privKeyBytes = await keyUtils.getPrivateKey(txInput, i);
      let pubKeyBytes = await keyUtils.toPublicKey(privKeyBytes);

      return pubKeyBytes;
    },

    /**
     * @param {Uint8Array} privKeyBytes
     * @param {Uint8Array} txHashBytes
     */
    sign: async function (privKeyBytes, txHashBytes) {
      // extraEntropy set to null to make gobject transactions idempotent
      let sigOpts = { canonical: true, extraEntropy: null };
      let sigBytes = await Secp256k1.sign(txHashBytes, privKeyBytes, sigOpts);

      return sigBytes;
    },

    /**
     * @param {Uint8Array} privKeyBytes
     */
    toPublicKey: async function (privKeyBytes) {
      let isCompressed = true;
      let pubKeyBytes = Secp256k1.getPublicKey(privKeyBytes, isCompressed);

      return pubKeyBytes;
    },
  };
  let dashTx = DashTx.create(keyUtils);
  let txInfoSigned = await dashTx.hashAndSignAll(txInfo);

  return txInfoSigned;
};

/**
 * @typedef DraftParams
 * @prop {import('dashgov').Selection} selection - The start and end epoch info.
 * @prop {String} name - Name of the proposal.
 * @prop {Number} paymentAmount - The amount of Dash for the proposal.
 * @prop {String} paymentAddress - Payment address for the proposal.
 * @prop {String} url - URL of the proposal.
 * @prop {String} wif - Wallet Import Format (WIF) key used for the burn address.
 * @prop {Array<typeof DashTx.TxInput>} utxos - coins to burn
 */

/**
 * @param {DraftParams} opts
 */
ProposalApp.draft = async function ({
  selection,
  name,
  paymentAddress,
  paymentAmount,
  url,
  wif,
  utxos,
}) {
  // TODO reject burn WIF if DASH >= 1.001
  let sats = DashTx.sum(utxos);
  if (sats >= 100100000) {
    throw new Error("refusing to burn > 1.001 DASH");
  }
  if (sats < 100000250) {
    throw new Error("need at least 1.000 DASH + 250 dust for fee");
  }

  let gobjData = DashGov.proposal.draftJson(selection, {
    name: name,
    payment_address: paymentAddress,
    payment_amount: paymentAmount,
    url: url,
  });

  let now = Date.now();
  let gobj = DashGov.proposal.draft(now, selection.start.startMs, gobjData, {});

  // TODO move into DashGov
  let gobjBurnBytes = DashGov.serializeForBurnTx(gobj);
  let gobjBurnHex = DashGov.utils.bytesToHex(gobjBurnBytes);

  let gobjHashBytes = await DashGov.utils.doubleSha256(gobjBurnBytes);
  let gobjid = DashGov.utils.hashToId(gobjHashBytes);

  let gobjHashBytesReverse = gobjHashBytes.slice();
  gobjHashBytesReverse = gobjHashBytesReverse.reverse();
  let gobjidLittleEndian = DashGov.utils.hashToId(gobjHashBytesReverse);

  console.log("");
  console.log("GObject Serialization (for hash for burn memo)");
  console.log(gobjBurnHex);

  console.log("");
  console.log("(Burnable) GObject ID (for op return memo)");
  console.log(gobjidLittleEndian);
  console.log("GObject ID (for 'gobject get <gobj-id>')");
  console.log(gobjid);

  // dash-cli -testnet getaddressutxos '{"addresses":["yT6GS8qPrhsiiLHEaTWPYJMwfPPVt2SSFC"]}'

  let txInfoSigned = await ProposalApp.signBurnTx({
    wif,
    utxos,
    gobjidLittleEndian,
  });
  console.log("");
  console.log("Signed Burn Transaction (ready for broadcast):");
  console.log(txInfoSigned.transaction);

  console.log("");
  console.log("Signed Burn Transaction ID:");
  let txid = await DashTx.getId(txInfoSigned.transaction);
  console.log(txid);

  return {
    // for saving to localStorage
    gobjData: gobjData,
    // important for next steps
    tx: txInfoSigned,
    txid: txid,
    gobj: gobj,
    gobjid: gobjid,
    // for debugging
    _gobjIdLittleEndian: gobjidLittleEndian,
  };
};

/**
 * @typedef SubmitParams
 * @prop {any?} [tx] - omit to not (re)send transaction // TODO type
 * @prop {String} txid
 * @prop {import('dashgov').GObject} gobj
 * @prop {String} gobjid
 * @prop {Boolean} [txsent]
 * @prop {Boolean} [gobjsent]
 */

/**
 * @param {SubmitParams} draft
 */
ProposalApp._$fullSubmit = async function (draft) {
  /** @type {HTMLElement} */ //@ts-expect-error
  let $log = document.querySelector(`[data-id="logtext"]`);

  $log.textContent += `validating again... `;
  await mustValidateGobj(draft.gobj);
  $log.textContent += `passed\n`;

  if (!draft.txsent) {
    $log.textContent += `broadcasting transaction for the first time... `;
    let txResult = await ProposalApp.rpc(
      "sendrawtransaction",
      draft.tx.transaction,
    );
    $log.textContent += `done\n`;

    console.log("");
    console.log("Transaction sent:");
    console.log(txResult);
    let d = new Date();
    let isoTime = d.toISOString();

    Object.assign(draft, { txsent: isoTime });
    $log.textContent += `saving to localStorage as 'submission-${draft.gobjid}'\n`;
    dbSet(`submission-${draft.gobjid}`, draft);
    $log.textContent += `saving to localStorage as 'submission-latest'\n`;
    dbSet("submission-latest", draft);
  }

  $log.textContent += `checking for confirmation of '${draft.txid}'...\n`;
  for (;;) {
    let txResult = await ProposalApp.rpc("gettxoutproof", [draft.txid]).catch(
      /** @param {Error} err */ function (err) {
        const E_NOT_IN_BLOCK = -5;
        // @ts-expect-error - code exists
        let code = err.code;
        if (code === E_NOT_IN_BLOCK) {
          return null;
        }
        throw err;
      },
    );
    if (txResult) {
      console.log("");
      console.log(`TxOutProof`);
      console.log(txResult);
      let jsonResult = await ProposalApp.rpc(
        "getrawtransaction",
        draft.txid,
        1,
      );
      console.log("");
      console.log(`Tx`);
      console.log(jsonResult);
      $log.textContent += `confirmed\n`;
      break;
    }

    $log.textContent += `checking again in 5s... \n`;
    console.log(`Waiting for block with TX ${draft.txid}...`);
    await DashGov.utils.sleep(5000);
  }

  async function submit() {
    let req = {
      method: "gobject",
      params: [
        "submit",
        draft.gobj.hashParent?.toString() || "0", // '0' must be a string for some reason
        draft.gobj.revision?.toString() || "1",
        draft.gobj.time.toString(),
        draft.gobj.dataHex,
        draft.txid,
      ],
    };
    let args = req.params.join(" ");
    console.log(`${req.method} ${args}`);
    let gobjResult = await ProposalApp.rpc("gobject", ...req.params).catch(
      /** @param {Error} err */ function (err) {
        const E_INVALID_COLLATERAL = -32603;
        // @ts-expect-error - code exists
        let code = err.code;
        if (code === E_INVALID_COLLATERAL) {
          // wait for burn to become valid
          console.error(code, err.message);
          return null;
        }
        throw err;
      },
    );

    return gobjResult;
  }

  $log.textContent += `submitting governance object... \n`;
  for (;;) {
    let gobjResult;
    if (!draft.gobjsent) {
      gobjResult = await submit();
    } else {
      //@ts-expect-error
      gobjResult = draft.gobjResult;
    }

    if (gobjResult) {
      $log.textContent += `submitted\n`;
      console.log("");
      console.log("gobject submit result:");
      console.log(gobjResult);

      let d = new Date();
      let isoTime = d.toISOString();
      Object.assign(draft, {
        gobjsent: isoTime,
        gobjResult: gobjResult,
      });
      $log.textContent += `updating 'submission-${draft.gobjid}' in localStorage\n`;
      dbSet(`submission-${draft.gobjid}`, draft);
      $log.textContent += `updating 'submission-latest' in localStorage\n`;
      dbSet("submission-latest", draft);
      break;
    }

    $log.textContent += `trying again in 5s... \n`;
    console.log(`Waiting for GObject ${draft.gobjid}...`);
    await DashGov.utils.sleep(5000);
  }

  $log.textContent += `success\n`;
};

/** @typedef {String} Hex */

export default ProposalApp;
