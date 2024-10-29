/**
 * This serialization is used exclusively for creating a hash to place in the OP_RETURN memo
 * of the collateral transaction.
 *
 * As such, it does NOT match the MN gobject serialization.
 *   - NO collateral tx id (this is for that)
 *   - NO masternodeOutpoint (this is for that)
 *   - NO bls data signature (happens on MN)
 *
 * However, it does include all pieces of data required to verify authenticity from proposer.
 * @typedef GObject
 * @prop {0} [hashParent] - not implemented, Uint8Array of 0s (32 bytes)
 * @prop {1} [revision] - not implemented, always 1 (4 bytes)
 * @prop {BigInt|Uint53} time - seconds since epoch (8 bytes)
 * @prop {String} dataHex - variable
 * @prop {null} [masternodeOutpoint] - ??
 * @prop {null} [collateralTxId] - 32 bytes of 0x00s
 * @prop {null} [collateralTxOutputIndex] - 4 bytes of 0xffs
 * @prop {null} [signature] - 0 bytes
 * @returns {Uint8Array}
 */

/**
 * @typedef GObjectData
 * @prop {Uint53} [end_epoch] - whole seconds since epoch (like web-standard `exp`)
 * @prop {String} name - kebab case (no spaces)
 * @prop {String} payment_address - base58-encoded p2pkh
 * @prop {Uint32} payment_amount - in whole DASH
 * @prop {Uint53} [start_epoch] - whole seconds since epoch (like web-standard `iat`)
 * @prop {Uint32} [type] - TODO
 * @prop {String} url - conventionally dashcentral, with page the same as the 'name'
 */

/**
 * @typedef Snapshot
 * @prop {Uint53} block - the block to be used for calculation
 * @prop {Uint53} ms - the time of that block in ms
 */

/**
 * @typedef Estimate
 * @prop {String} startIso
 * @prop {Uint53} startMs - suggested time to make proposal visible
 * @prop {Uint53} voteHeight
 * @prop {Uint53} voteDelta
 * @prop {String} voteIso - date in ISO format
 * @prop {Uint53} voteMs
 * @prop {Uint53} voteDeltaMs
 * @prop {Uint53} superblockHeight
 * @prop {Uint53} superblockDelta
 * @prop {String} superblockIso - date in ISO format
 * @prop {Uint53} superblockMs
 * @prop {Uint53} superblockDeltaMs
 * @prop {String} endIso
 * @prop {Uint53} endMs - suggested time to make proposal non-visible
 */

/**
 * @typedef Estimates
 * @prop {Estimate} last - the most recent superblock
 * @prop {Estimate?} lameduck - the current voting period, if close to deadline
 * @prop {Array<Estimate>} upcoming - future voting periods
 */

let DashGov = {};
// Adapted from
//   github.com/dashpay/dash/tree/develop/src/governance/common.cpp

let Crypto = globalThis.crypto;

const LITTLE_ENDIAN = true;
const VARINT_8_MAX = 252;
const UINT_16_MAX = 65535;
const UINT_32_MAX = 4294967295;

let textEncoder = new TextEncoder();

DashGov._type = 0b0000010; // from SER_GETHASH (bitwise enum)
DashGov._typeBytes = Uint8Array.from([0b0000010]);
DashGov._protocalVersion = 70231; // 0x00011257 (BE) => 0x57120100 (LE)
DashGov._protocalVersionBytes = Uint8Array.from([0x57, 0x12, 0x01, 0x00]);

DashGov.utils = {};

/**
 * @param {Uint8Array} bytes
 * @returns {String} hex
 */
DashGov.utils.bytesToHex = function bytesToHex(bytes) {
  let hexes = [];
  for (let i = 0; i < bytes.length; i += 1) {
    let b = bytes[i];
    let h = b.toString(16);
    h = h.padStart(2, "0");
    hexes.push(h);
  }
  let hex = hexes.join("");
  return hex;
};

/**
 * @param {Number} ms
 */
DashGov.utils.sleep = async function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
};

/**
 * @param {Uint8Array} bytes - i.e. serialized gobj bytes
 */
DashGov.utils.doubleSha256 = async function (bytes) {
  let hash1 = await Crypto.subtle.digest("SHA-256", bytes);
  let hash2 = await Crypto.subtle.digest("SHA-256", hash1);
  let gobjHash = new Uint8Array(hash2);

  return gobjHash;
};

/**
 * @param {Uint8Array} hashBytes
 */
DashGov.utils.hashToId = function (hashBytes) {
  let reverseBytes = hashBytes.slice();
  reverseBytes.reverse();

  let id = DashGov.utils.bytesToHex(reverseBytes);
  return id;
};

/**
 * Gets the number of bytes to store the number with VarInt "compression"
 *   - 1 byte for 0-252 (Uint8)
 *   - 1+2 bytes for 253 + Uint16
 *   - 1+4 bytes for 254 + Uint32
 *   - 1+8 bytes for 255 + Uint64
 * @param {Number} n
 * @returns {1|3|5|9}
 */
DashGov.utils.toVarIntSize = function (n) {
  if (n <= VARINT_8_MAX) {
    return 1;
  }

  if (n <= UINT_16_MAX) {
    return 3;
  }

  if (n <= UINT_32_MAX) {
    return 5;
  }

  return 9;
};

/**
 * Writes `n` to `DataView` as a VarInt ("compressed" int).
 * @param {DataView} dv
 * @param {Number} offset
 * @param {Number} n
 * @returns void
 */
function writeVarInt(dv, offset, n) {
  if (n <= VARINT_8_MAX) {
    dv.setUint8(offset, n);
    return;
  }

  let size;
  if (n <= UINT_16_MAX) {
    size = 253;
  } else if (n <= UINT_32_MAX) {
    size = 254;
  } else {
    size = 255;
  }
  dv.setUint8(offset, size);

  offset += 1;
  let bigN = BigInt(n);
  dv.setBigUint64(offset, bigN, LITTLE_ENDIAN);
}

/**
 * @param {GObject} gobj
 */
DashGov.serializeForBurnTx = function ({
  hashParent = 0,
  revision = 1,
  time,
  dataHex,
}) {
  const varIntSize = DashGov.utils.toVarIntSize(dataHex.length);

  const dataLen =
    32 + // hashParent
    4 + // revision
    8 + // time
    varIntSize + // compacted length header for HexStr(vchData)
    dataHex.length + // HexStr(vchData)
    32 +
    4 + // masterNodeOutpoint (not used, so these bytes are the defaults)
    1 +
    4 + // dummy values to match old hashing
    1; // (varint) size of `vchSig` (always 1 byte to represent 0)

  const bytes = new Uint8Array(dataLen);
  const dv = new DataView(bytes.buffer);

  let offset = 0;

  if (hashParent) {
    bytes.set(hashParent, offset);
  }
  offset += 32;

  dv.setInt32(offset, revision, LITTLE_ENDIAN);
  offset += 4;

  let bigTime = BigInt(time);
  dv.setBigInt64(offset, bigTime, LITTLE_ENDIAN);
  offset += 8;

  void writeVarInt(dv, offset, dataHex.length);
  offset += varIntSize;
  let dataHexBytes = textEncoder.encode(dataHex);
  bytes.set(dataHexBytes, offset);
  offset += dataHex.length;

  {
    // masternodeOutpointId (hash + index) is required for legacy reasons,
    // but not used for collateral serialization
    offset += 32;

    // Write out default mastNode `n` (index)
    let masternodeOutpointIndex = 0xffffffff;
    dv.setUint32(offset, masternodeOutpointIndex, LITTLE_ENDIAN);
    offset += 4;

    // adding dummy values here to match old hashing
    offset += 1;
    dv.setUint32(offset, 0xffffffff, LITTLE_ENDIAN);
    offset += 4;
  }

  // the trailing 0 byte represents the VarInt Size of the vchSig,
  // which is always 0 for collateral serialization
  offset += 1;
  return bytes;
};

// TODO move to a nice place
const SUPERBLOCK_INTERVAL = 16616;
const VOTE_LEAD_BLOCKS = 1662;

// these are chosen by reason rather than by specification
const PROPOSAL_LEAD_MS = 6 * 24 * 60 * 60 * 1000;
const START_EPOCH_MS_BEFORE_VOTE = 23 * 24 * 60 * 60 * 1000;
const END_EPOCH_MS_AFTER_SUPERBLOCK = 4 * 24 * 60 * 60 * 1000; // after superblock
DashGov.PROPOSAL_LEAD_MS = PROPOSAL_LEAD_MS;
DashGov.SUPERBLOCK_INTERVAL = SUPERBLOCK_INTERVAL;

// not used because the actual average at any time is always closer to 157.5
//const SECONDS_PER_BLOCK_ESTIMATE = 155;
DashGov._AVG_SECS_PER_BLOCK = 157.5816652623977;

// used to calculate ~5 year (~60 month) averages
const MONTHLY_SUPERBLOCK_01_DATE = "2017-03-05T20:16:05Z";
const MONTHLY_SUPERBLOCK_01 = 631408;
const MONTHLY_SUPERBLOCK_61_DATE = "2022-02-26T03:53:02Z";
const MONTHLY_SUPERBLOCK_61 = 1628368;

/**
 * @param {Snapshot} snapshot
 * @param {Snapshot} root
 * @returns {Float64} - fractional seconds
 */
DashGov.measureSecondsPerBlock = function (snapshot, root) {
  let blockDelta = snapshot.block - root.block;
  let timeDelta = snapshot.ms - root.ms;
  let msPerBlock = timeDelta / blockDelta;
  let sPerBlock = msPerBlock / 1000;

  return sPerBlock;
};

/**
 * @param {Snapshot?} [snapshot] - defaults to mainnet monthly superblock 61
 * @returns {Float64} - fractional seconds
 */
DashGov.estimateSecondsPerBlock = function (snapshot) {
  if (!snapshot) {
    snapshot = {
      block: MONTHLY_SUPERBLOCK_61,
      ms: Date.parse(MONTHLY_SUPERBLOCK_61_DATE),
    };
  }
  let root = {
    block: MONTHLY_SUPERBLOCK_01,
    ms: Date.parse(MONTHLY_SUPERBLOCK_01_DATE),
  };

  let spb = DashGov.measureSecondsPerBlock(snapshot, root);
  return spb;
};

/**
 * @param {Uint53} ms - the current time
 * @param {Float64} secondsPerBlock
 */
DashGov.estimateBlockHeight = function (ms, secondsPerBlock) {
  let then = Date.parse(MONTHLY_SUPERBLOCK_61_DATE);
  let delta = ms - then;
  let deltaS = delta / 1000;
  let blocks = deltaS / secondsPerBlock;
  blocks = Math.round(blocks);

  let height = MONTHLY_SUPERBLOCK_61 + blocks;
  return height;
};

/**
 * @typedef Selection
 * @prop {Estimate} start
 * @prop {Estimate} end
 */

/**
 * @param {Estimates} estimates
 * @param {Uint32} startPeriod
 * @param {Uint32} endPeriod
 * @returns {Selection}
 */
DashGov.selectEstimates = function (estimates, startPeriod, endPeriod) {
  let startEstimate;
  let endEstimate;

  if (startPeriod === 0) {
    startEstimate = estimates.lameduck;
  } else {
    startPeriod -= 1;
    startEstimate = estimates.upcoming[startPeriod];
  }
  if (!startEstimate) {
    throw new Error(
      `${startPeriod} is not valid ('startPeriod' might not be a number)`,
    );
  }

  if (endPeriod === 0) {
    endEstimate = estimates.lameduck;
  } else {
    endPeriod -= 1;
    endEstimate = estimates.upcoming[endPeriod];
  }
  if (!endEstimate) {
    throw new Error(
      `${endPeriod} is not valid ('count' might not be a number)`,
    );
  }

  return { start: startEstimate, end: endEstimate };
};

DashGov.proposal = {};

/**
 * @param {Object} selected
 * @param {Estimate} selected.start
 * @param {Estimate} selected.end
 * @param {GObjectData} proposalData
 * @returns {Required<GObjectData>}
 */
DashGov.proposal.draftJson = function (selected, proposalData) {
  let startEpoch = selected.start.startMs / 1000;
  startEpoch = Math.round(startEpoch);

  let endEpoch = selected.end.endMs / 1000;
  endEpoch = Math.round(endEpoch);

  let normalizedData = {
    end_epoch: Math.round(endEpoch),
    name: "",
    payment_address: "",
    payment_amount: 0,
    start_epoch: Math.round(startEpoch),
    type: 1,
    url: "",
  };
  Object.assign(normalizedData, proposalData);

  return normalizedData;
};

/**
 * Creates a draft object with reasonable and default values
 * @param {Uint53} now - use Date.now(), except in testing
 * @param {Uint53} startEpochMs - used to create a deterministic gobject time
 * @param {Required<GObjectData>} data - will be sorted and hex-ified
 * @param {Partial<GObject>} [gobj] - override values
 */
DashGov.proposal.draft = function (now, startEpochMs, data, gobj) {
  let dataHex = gobj?.dataHex || DashGov.proposal.sortAndEncodeJson(data);
  let time = DashGov.proposal._selectKnownTime(now, startEpochMs);

  /** @type {GObject} */
  let normalGObj = {
    hashParent: 0,
    revision: 1,
    time: time,
    dataHex: "",
    masternodeOutpoint: null,
    collateralTxId: null,
    collateralTxOutputIndex: null,
    signature: null,
  };
  Object.assign(normalGObj, gobj, { dataHex });

  return normalGObj;
};

/**
 * @param {Required<GObjectData>} normalizedData
 */
DashGov.proposal.sortAndEncodeJson = function (normalizedData) {
  let keys = Object.keys(normalizedData);
  keys.sort();

  /** @type {GObjectData} */
  //@ts-ignore
  let sortedData = {};
  for (let key of keys) {
    //@ts-ignore - this is the same type as normalData, but future-proofed
    sortedData[key] = normalizedData[key];
  }

  let textEncoder = new TextEncoder();
  let json = JSON.stringify(sortedData);
  let jsonBytes = textEncoder.encode(json);
  let hex = DashGov.utils.bytesToHex(jsonBytes);

  return hex;
};

/**
 * The arbitrary use of random times is a leading cause of lost money during
 * the proposal process, so instead we use the 'start epoch' when appropriate,
 * or otherwise a UTC day interval of the start epoch
 * @param {Uint53} now
 * @param {Uint53} startMs
 */
DashGov.proposal._selectKnownTime = function (now, startMs) {
  let startEpochDate = new Date(startMs);
  let today = new Date();
  if (today < startEpochDate) {
    let date = today.getUTCDate();
    startEpochDate.setUTCFullYear(today.getUTCFullYear());
    startEpochDate.setUTCMonth(today.getUTCMonth());
    startEpochDate.setUTCDate(date - 1);
  }
  let knownTimeMs = startEpochDate.valueOf();
  let knownSecs = knownTimeMs / 1000;
  knownSecs = Math.floor(knownSecs);

  return knownSecs;
};

let msToHours = 60 * 60 * 1000;
/**
 * Since the estimates are only accurate to within 30 minutes anyway,
 * and since the extra entropy on the time just makes it more difficult to read,
 * we just get rid of it.
 * @param {Uint53} ms
 */
DashGov.proposal._roundDownToHour = function (ms) {
  let timeF = ms / msToHours;
  let time = Math.floor(timeF);
  ms = time * msToHours;
  return ms;
};

/**
 * @param {Uint53} ms
 */
DashGov.proposal._roundUpToHour = function (ms) {
  let timeF = ms / msToHours;
  let time = Math.ceil(timeF);
  ms = time * msToHours;
  return ms;
};

/**
 * Note: since we're dealing with estimates that are typically reliable
 *       within an hour (and often even within 15 minutes), this may
 *       generate more results than it presents.
 * @param {Uint8} [cycles] - 3 by default
 * @param {Snapshot?} [snapshot]
 * @param {Uint32} [proposalLeadtime] - default 3 days in ms
 * @param {Float64} [secondsPerBlock] - typically close to 157.6
 * @returns {Estimates} - the last, due, and upcoming proposal cycles
 */
DashGov.estimateProposalCycles = function (
  cycles = 3,
  snapshot = null,
  secondsPerBlock = 0,
  proposalLeadtime = PROPOSAL_LEAD_MS,
) {
  let now = snapshot?.ms || Date.now();
  let currentBlock = snapshot?.block;
  if (!secondsPerBlock) {
    if (currentBlock) {
      snapshot = { block: currentBlock, ms: now };
    }
    secondsPerBlock = DashGov.estimateSecondsPerBlock(snapshot);
  }
  if (!currentBlock) {
    currentBlock = DashGov.estimateBlockHeight(now, secondsPerBlock);
  }

  /** @type {Array<Estimate>} */
  let estimates = [];
  for (let i = 0; i <= cycles + 1; i += 1) {
    let estimate = DashGov.estimateNthNextGovCycle(
      { block: currentBlock, ms: now },
      secondsPerBlock,
      i,
    );
    estimates.push(estimate);
  }

  {
    /** @type {Estimate} */
    //@ts-ignore - we know there is at least one (past) estimate
    let last = estimates.shift();

    /** @type {Estimate?} */
    let lameduck = null;
    if (estimates.length) {
      if (estimates[0].voteDeltaMs < proposalLeadtime) {
        //@ts-ignore - we just checked the length
        lameduck = estimates.shift();
      } else {
        // lose the extra cycle
        void estimates.pop();
      }
    }
    let upcoming = estimates;

    return {
      last,
      lameduck,
      upcoming,
    };
  }
};

/**
 * @param {Snapshot} snapshot
 * @param {Float64} secondsPerBlock
 * @param {Uint53} [offset] - how many superblocks in the future
 * @returns {Estimate} - details about the current governance cycle
 */
DashGov.estimateNthNextGovCycle = function (
  snapshot,
  secondsPerBlock,
  offset = 0,
) {
  if (!secondsPerBlock) {
    secondsPerBlock = DashGov.estimateSecondsPerBlock(snapshot);
  }

  let superblockHeight = DashGov.getNthNextSuperblock(snapshot.block, offset);

  let superblockDelta = superblockHeight - snapshot.block;
  let superblockDeltaMs = superblockDelta * secondsPerBlock * 1000;
  let voteDeltaMs = VOTE_LEAD_BLOCKS * secondsPerBlock * 1000;

  let d = new Date(snapshot.ms);
  d.setUTCMilliseconds(0);

  d.setUTCMilliseconds(superblockDeltaMs);
  let sbms = d.valueOf();
  let sbts = d.toISOString();

  d.setUTCMilliseconds(-voteDeltaMs);
  let vtms = d.valueOf();
  let vtts = d.toISOString();

  let startMs = vtms - START_EPOCH_MS_BEFORE_VOTE;
  startMs = DashGov.proposal._roundDownToHour(startMs);
  let startTime = new Date(startMs);

  let endMs = sbms + END_EPOCH_MS_AFTER_SUPERBLOCK;
  endMs = DashGov.proposal._roundUpToHour(endMs);
  let endTime = new Date(endMs);

  return {
    // TODO split into objects
    startMs: startMs,
    startIso: startTime.toISOString(),
    voteHeight: superblockHeight - VOTE_LEAD_BLOCKS,
    voteIso: vtts,
    voteMs: vtms,
    voteDelta: superblockDelta - VOTE_LEAD_BLOCKS,
    voteDeltaMs: superblockDeltaMs - voteDeltaMs,
    superblockHeight: superblockHeight,
    superblockDelta: superblockDelta,
    superblockIso: sbts,
    superblockMs: sbms,
    superblockDeltaMs: superblockDeltaMs,
    endMs: endMs,
    endIso: endTime.toISOString(),
  };
};

/**
 * @param {Uint53} height
 * @param {Uint53} offset - 0 (current / previous), 1 (next), 2, 3, nth
 * @returns {Uint53} - the superblock after the given height
 */
DashGov.getNthNextSuperblock = function (height, offset) {
  let superblockCount = height / SUPERBLOCK_INTERVAL;
  superblockCount = Math.floor(superblockCount);

  superblockCount += offset;
  let superblockHeight = superblockCount * SUPERBLOCK_INTERVAL;

  return superblockHeight;
};

export default DashGov;

/** @typedef {bigint} BigInt */
/** @typedef {Number} Uint8 */
/** @typedef {Number} Uint32 */
/** @typedef {Number} Uint53 */
/** @typedef {Number} Float64 */
