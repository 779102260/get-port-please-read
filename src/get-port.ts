import { isSafePort } from "./unsafe-ports";

import type {
  GetPortInput,
  PortNumber,
  GetPortOptions,
  HostAddress,
  WaitForPortOptions,
} from "./types";

import {
  GetPortError,
  _findPort,
  _fmtOnHost,
  _generateRange,
  _getLocalHosts,
  _tryPort,
  _log,
  _validateHostname,
} from "./_internal";

export async function getPort(
  _userOptions: GetPortInput = {},
): Promise<PortNumber> {
  if (typeof _userOptions === "number" || typeof _userOptions === "string") {
    _userOptions = { port: Number.parseInt(_userOptions + "") || 0 };
  }

  const _port = Number(_userOptions.port ?? process.env.PORT ?? 3000);

  const options = {
    name: "default",
    random: _port === 0,
    ports: [],
    portRange: [],
    alternativePortRange: _userOptions.port ? [] : [3000, 3100],
    verbose: false,
    ..._userOptions,
    port: _port,
    host: _validateHostname(
      _userOptions.host ?? process.env.HOST,
      _userOptions.public,
      _userOptions.verbose,
    ),
  } as GetPortOptions;

  if (options.random) {
    return getRandomPort(options.host);
  }

  // Generate list of ports to check
  // 构建端口列表
  const portsToCheck: PortNumber[] = [
    options.port,
    ...options.ports,
    ..._generateRange(...options.portRange),
  ].filter((port) => {
    if (!port) {
      return false;
    }
    if (!isSafePort(port)) {
      _log(options.verbose, `Ignoring unsafe port: ${port}`);
      return false;
    }
    return true;
  });

  // Try to find a port
  // 寻找可用的端口：未占用且非常用端口
  // 未占用端口的检测原理：通过net模块尝试使用端口，看看能不能启动服务
  let availablePort = await _findPort(portsToCheck, options.host);

  // Try fallback port range
  // 尝试从备用端口范围（alternativePortRange）中寻找
  if (!availablePort && options.alternativePortRange.length > 0) {
    availablePort = await _findPort(
      _generateRange(...options.alternativePortRange),
      options.host,
    );
    _log(
      options.verbose,
      `Unable to find an available port (tried ${options.alternativePortRange.join(
        "-",
      )} ${_fmtOnHost(options.host)}). Using alternative port ${availablePort}`,
    );
  }

  // Try random port
  // 随机使用一个端口
  if (!availablePort && _userOptions.random !== false) {
    availablePort = await getRandomPort(options.host);
    if (availablePort) {
      _log(options.verbose, `Using random port ${availablePort}`);
    }
  }

  // Throw error if no port is available
  // 只能报错了
  if (!availablePort) {
    const triedRanges = [
      options.port,
      options.portRange.join("-"),
      options.alternativePortRange.join("-"),
    ]
      .filter(Boolean)
      .join(", ");
    throw new GetPortError(
      `Unable to find find available port ${_fmtOnHost(
        options.host,
      )} (tried ${triedRanges})`,
    );
  }

  return availablePort;
}

export async function getRandomPort(host?: HostAddress) {
  const port = await checkPort(0, host);
  if (port === false) {
    throw new GetPortError(
      `Unable to find any random port ${_fmtOnHost(host)}`,
    );
  }
  return port;
}

export async function waitForPort(
  port: PortNumber,
  options: WaitForPortOptions = {},
) {
  const delay = options.delay || 500;
  const retries = options.retries || 4;
  for (let index = retries; index > 0; index--) {
    if ((await _tryPort(port, options.host)) === false) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new GetPortError(
    `Timeout waiting for port ${port} after ${retries} retries with ${delay}ms interval.`,
  );
}

export async function checkPort(
  port: PortNumber,
  host: HostAddress | HostAddress[] = process.env.HOST,
  verbose?: boolean,
): Promise<PortNumber | false> {
  if (!host) {
    host = _getLocalHosts([undefined /* default */, "0.0.0.0"]);
  }
  if (!Array.isArray(host)) {
    return _tryPort(port, host);
  }
  for (const _host of host) {
    const _port = await _tryPort(port, _host);
    if (_port === false) {
      if (port < 1024 && verbose) {
        _log(
          verbose,
          `Unable to listen to the priviliged port ${port} ${_fmtOnHost(
            _host,
          )}`,
        );
      }
      return false;
    }
    if (port === 0 && _port !== 0) {
      port = _port;
    }
  }
  return port;
}
