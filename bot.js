#!/usr/bin/env node

// ==UserScript==
// @name         StandX Maker Bot (Terminal)
// @version      11.11
// @description  StandX 自动做市机器人 - 终端版
// @author       币圈毒瘤@CryptoTumor9527
// ==/UserScript==

import { ed25519 } from '@noble/curves/ed25519.js';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';
import readline from 'readline';
import fetch from 'node-fetch';
import https from 'https';

class StandXAPIBot {
    constructor(config) {
        this.config = {
            baseURL: 'https://perps.standx.com',
            geoURL: 'https://geo.standx.com',
            apiToken: config.apiToken,
            privateKeyStr: config.privateKey,
            leverage: config.leverage || 5,
            priceOffset: 0.0009, // 固定开单偏移 0.09%
            orderValue: config.orderValue || 2000,
            side: config.side || 'long',
            autoClosePosition: config.autoClosePosition !== false,
            checkIntervalMin: config.checkIntervalMin || 500,
            checkIntervalMax: config.checkIntervalMax || 1000,
            refreshIntervalMin: config.refreshIntervalMin || 120000,
            refreshIntervalMax: config.refreshIntervalMax || 180000,
            maxPriceDeviation: config.maxPriceDeviation || 0.002, // 价格偏离阈值 (默认 0.2%)
            safetyThreshold: config.safetyThreshold || 0.0005
        };

        this.isRunning = false;
        this.lastPrice = null;
        this.intervalId = null;
        this.refreshIntervalId = null;
        this.leverageSet = false;
        this.lastRefreshTime = 0;
        this.nextRefreshTime = 0; // 下次随机刷新时间点
        this.privateKey = null;
        this.activeOrders = [];
        this.timeOffset = 0;
        this.isProcessing = false;
        this.lastPlacedOrders = new Map();

        this.agent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 256
        });
    }

    importPrivateKey() {
        try {
            if (!this.config.privateKeyStr) throw new Error('未提供私钥');
            this.log('🔐 正在导入私钥...');
            const keyStr = this.config.privateKeyStr.trim();
            let keyBytes;
            let format = 'unknown';

            try {
                const bs58Bytes = bs58.decode(keyStr);
                if (bs58Bytes.length === 32) {
                    keyBytes = bs58Bytes;
                    format = 'Base58';
                }
            } catch (e) { }

            if (!keyBytes) {
                try {
                    const base64Bytes = Buffer.from(keyStr, 'base64');
                    if (base64Bytes.length === 32) {
                        keyBytes = new Uint8Array(base64Bytes);
                        format = 'Base64';
                    } else if (base64Bytes.length === 33) {
                        keyBytes = new Uint8Array(base64Bytes.slice(1));
                        format = 'Base64 (33 bytes)';
                    }
                } catch (e) { }
            }

            if (!keyBytes || keyBytes.length !== 32) throw new Error(`私钥格式错误`);
            this.privateKey = keyBytes;
            this.log(`✅ 私钥导入成功 (${format})`);
        } catch (error) {
            this.log(`❌ 私钥导入失败: ${error.message}`);
            throw error;
        }
    }

    async syncTime() {
        try {
            this.log('🕒 正在从 Geo API 同步精准时间...');
            const response = await fetch(`${this.config.geoURL}/v1/region`, {
                method: 'GET',
                agent: this.agent,
                timeout: 3000
            });

            if (response.ok) {
                const data = await response.json();
                if (data.systemTime) {
                    const serverTime = data.systemTime;
                    this.timeOffset = serverTime - Date.now();
                    this.log(`✅ 时间同步完成 (Geo): Server=${serverTime}, Local=${Date.now()}, Offset=${this.timeOffset}ms`);
                    return;
                }
            }
            throw new Error('Geo API 响应无 systemTime');
        } catch (geoError) {
            this.log(`⚠️ Geo API 时间同步失败 (${geoError.message})，尝试使用 HTTP 头...`);
            try {
                const response = await fetch(`${this.config.baseURL}/api/query_positions?symbol=BTC-USD`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${this.config.apiToken}` },
                    agent: this.agent
                });

                const serverDateStr = response.headers.get('date');
                if (serverDateStr) {
                    const serverTime = new Date(serverDateStr).getTime();
                    this.timeOffset = serverTime - Date.now();
                    this.log(`✅ 时间同步完成 (Header): 偏移 ${this.timeOffset}ms`);
                } else {
                    this.log('⚠️ 无法获取服务器时间头，使用本地时间');
                }
            } catch (e) {
                this.log(`⚠️ 时间同步完全失败，使用本地时间`);
            }
        }
    }

    async signRequest(payload) {
        if (!this.privateKey) this.importPrivateKey();
        const xRequestVersion = 'v1';
        const xRequestId = uuidv4();
        const xRequestTimestamp = Date.now() + this.timeOffset;

        const signMsg = `${xRequestVersion},${xRequestId},${xRequestTimestamp},${payload}`;
        const messageBytes = Buffer.from(signMsg, 'utf-8');
        const signature = ed25519.sign(messageBytes, this.privateKey);
        const signatureBase64 = Buffer.from(signature).toString('base64');

        return {
            'x-request-sign-version': xRequestVersion,
            'x-request-id': xRequestId,
            'x-request-timestamp': xRequestTimestamp.toString(),
            'x-request-signature': signatureBase64
        };
    }

    async apiRequest(method, endpoint, data = null) {
        const url = `${this.config.baseURL}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json'
        };

        if (method === 'POST' && data) {
            const payload = JSON.stringify(data);
            const signatureHeaders = await this.signRequest(payload);
            Object.assign(headers, signatureHeaders);
        }

        try {
            const options = { method, headers, agent: this.agent };
            if (method === 'POST' && data) options.body = JSON.stringify(data);

            const response = await fetch(url, options);

            if (response.status === 404 && endpoint.includes('cancel_all')) {
                return { code: 0, message: 'No orders to cancel' };
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            if (result.code !== undefined && result.code !== 0) {
                throw new Error(`API Error Code ${result.code}: ${result.message || 'Unknown error'}`);
            }

            return result;
        } catch (error) {
            if (error.message.includes('socket disconnected') || error.message.includes('ECONNRESET')) {
                throw new Error(`Network Error: ${error.message}`);
            }
            throw error;
        }
    }

    async getCurrentPosition() {
        try {
            const result = await this.apiRequest('GET', '/api/query_positions?symbol=BTC-USD');
            const position = Array.isArray(result) ? result[0] : result;
            if (!position) return null;

            const qty = parseFloat(position.qty || 0);
            const entryPrice = parseFloat(position.entry_price || 0);
            if (qty === 0 || entryPrice === 0) return null;

            return { qty, entryPrice, side: qty > 0 ? 'LONG' : 'SHORT' };
        } catch (error) {
            this.log(`❌ 获取持仓失败: ${error.message}`);
            return null;
        }
    }

    async hasActiveOrders() {
        try {
            const result = await this.apiRequest('GET', '/api/query_open_orders?symbol=BTC-USD');
            let orders = [];
            if (result && Array.isArray(result.result)) {
                orders = result.result;
            } else if (Array.isArray(result)) {
                orders = result;
            }

            this.activeOrders = orders;
            return this.activeOrders.length > 0;
        } catch (error) {
            this.log(`❌ 检查订单失败: ${error.message}`);
            return false;
        }
    }

    async cancelAllOrders() {
        try {
            this.log('🗑️ 取消所有订单...');

            // 1. 先查询活跃订单
            const result = await this.apiRequest('GET', '/api/query_open_orders?symbol=BTC-USD');
            let orders = [];
            if (result && Array.isArray(result.result)) {
                orders = result.result;
            } else if (Array.isArray(result)) {
                orders = result;
            }

            if (!orders || orders.length === 0) {
                // this.log('✅ 无订单需要取消'); 
                return;
            }

            const orderIds = orders.map(o => o.order_id || o.id);
            if (orderIds.length === 0) return;

            this.log(`📋 发现 ${orderIds.length} 个订单，执行批量取消...`);

            // 2. 尝试批量取消 (参考 UI Bot)
            // 某些 API 可能使用 cancel_orders + order_id_list
            try {
                // 尝试 endpoint A: /api/cancel_orders (Batch)
                await this.apiRequest('POST', '/api/cancel_orders', { order_id_list: orderIds });
                this.log(`✅ 批量取消成功`);
            } catch (batchError) {
                this.log(`⚠️ 批量取消失败 (${batchError.message})，尝试逐个取消...`);
                // 3. 回退方案: 逐个取消
                for (const id of orderIds) {
                    try {
                        await this.apiRequest('POST', '/api/cancel_order', { order_id: id, symbol: 'BTC-USD' });
                    } catch (e) {
                        this.log(`⚠️ 取消订单 ${id} 失败: ${e.message}`);
                    }
                }
                this.log(`✅ 逐个取消流程完成`);
            }

            this.lastPlacedOrders.clear();
        } catch (error) {
            this.log(`⚠️ 取消订单异常: ${error.message}`);
        }
    }

    async setLeverage(leverage) {
        try {
            this.log(`⚙️ 设置杠杆: ${leverage}x`);
            await this.apiRequest('POST', '/api/change_leverage', { symbol: 'BTC-USD', leverage });
            this.log(`✅ 杠杆已设置为 ${leverage}x`);
            this.leverageSet = true;
        } catch (error) {
            this.log(`❌ 设置杠杆失败: ${error.message}`);
        }
    }

    async getCurrentPrice() {
        try {
            const result = await this.apiRequest('GET', '/api/query_positions?symbol=BTC-USD');
            const position = Array.isArray(result) ? result[0] : result;
            return parseFloat(position.mark_price || 0);
        } catch (error) {
            this.log(`❌ 获取价格失败: ${error.message}`);
            return null;
        }
    }

    async placeOrder(side, price, qty) {
        try {
            const orderData = {
                symbol: 'BTC-USD', side, order_type: 'limit',
                price: price.toFixed(2), qty: qty.toFixed(4),
                time_in_force: 'gtc', reduce_only: false
            };
            this.log(`📝 下单: ${side} ${qty.toFixed(4)} BTC @ $${price.toFixed(2)}`);
            await this.apiRequest('POST', '/api/new_order', orderData);
            this.log(`✅ ${side} 订单已提交`);

        } catch (error) {
            this.log(`❌ 下单失败: ${error.message}`);
        }
    }

    async closePosition(position) {
        try {
            this.log(`🔄 平仓: ${position.side} ${Math.abs(position.qty)} BTC`);
            await this.apiRequest('POST', '/api/new_order', {
                symbol: 'BTC-USD', side: position.side === 'LONG' ? 'sell' : 'buy',
                order_type: 'market', qty: Math.abs(position.qty).toFixed(4), reduce_only: true
            });
            this.log(`✅ 平仓订单已提交`);
        } catch (error) {
            this.log(`❌ 平仓失败: ${error.message}`);
        }
    }

    async checkAndTrade() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const [position, currentPrice, hasOrders] = await Promise.all([
                this.getCurrentPosition(),
                this.getCurrentPrice(),
                this.hasActiveOrders()
            ]);

            if (position) {
                if (this.config.autoClosePosition) {
                    this.log(`⚠️ 检测到持仓, 自动平仓...`);
                    await this.closePosition(position);
                    await this.sleep(1000);
                    return;
                } else {
                    return;
                }
            }

            if (!currentPrice) return;

            let deviation = 0;
            if (this.lastPrice) {
                deviation = Math.abs(currentPrice - this.lastPrice) / this.lastPrice;
            }

            if (hasOrders) {
                if (this.lastPrice && deviation > this.config.maxPriceDeviation) {
                    this.log(`🔄 价格变动 > ${(this.config.maxPriceDeviation * 100).toFixed(1)}% (太远), 刷新订单...`);
                    await this.cancelAllOrders();
                    return;
                }
                // 2. 检查价格接近 (避险):
                // 初始差距 0.09% (0.0009). 要求保留 0.05% (0.0005).
                // 所以允许的市场波动即为 0.09% - 0.05% = 0.04% (0.0004).
                const safeMoveThreshold = this.config.priceOffset - this.config.safetyThreshold;
                if (this.lastPrice && deviation > safeMoveThreshold) {
                    this.log(`⚠️ 市场波动 > ${(deviation * 100).toFixed(3)}% (可能接近订单), 撤单避险...`);
                    await this.cancelAllOrders();
                    return;
                }
                // 3. 检查随机定时刷新 (2-3分钟)
                else if (Date.now() > this.nextRefreshTime) {
                    this.log(`⏰ 定时刷新触发 (2-3min), 重置订单...`);
                    await this.cancelAllOrders();
                    this.nextRefreshTime = Date.now() + 30000; // 防止重复触发，给 30s 缓冲等待重挂
                    return;
                }
                else {
                    const timeLeft = Math.round((this.nextRefreshTime - Date.now()) / 1000);
                    this.logStatus(`监控中 | 价格: $${currentPrice.toFixed(2)} | 偏离: ${(deviation * 100).toFixed(3)}% | 倒计时: ${timeLeft}s | 订单: ${this.activeOrders.length}`);
                    return;
                }
            }

            const freshPrice = currentPrice;

            let side = this.config.side;
            if (side === 'random') side = Math.random() > 0.5 ? 'long' : 'short';
            const sides = side === 'both' ? ['long', 'short'] : [side];

            for (const s of sides) {
                const orderSide = s === 'long' ? 'buy' : 'sell';
                const multiplier = s === 'long' ? (1 - this.config.priceOffset) : (1 + this.config.priceOffset);
                const orderPrice = freshPrice * multiplier;
                const orderQty = this.config.orderValue / orderPrice;

                await this.placeOrder(orderSide, orderPrice, orderQty);
                if (sides.length > 1) await this.sleep(100);
            }

            this.log(`✅ 挂单完成`);
            this.lastPrice = freshPrice;

            // 设定下一次随机刷新时间: 当前时间 + 120~180秒 (2-3分钟)
            const randomDelay = Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
            this.nextRefreshTime = Date.now() + randomDelay;
            // this.log(`📅 下次刷新时间: ${new Date(this.nextRefreshTime).toLocaleTimeString()}`);

        } catch (error) {
            this.log(`❌ 交易检查异常: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        this.log('\n🚀 启动 StandX Maker Bot v11.11 (Author:币圈毒瘤)...\n');
        this.importPrivateKey();
        await this.syncTime();

        const initialPosition = await this.getCurrentPosition();
        if (initialPosition && this.config.autoClosePosition) {
            await this.closePosition(initialPosition);
        }

        if (!this.leverageSet) await this.setLeverage(this.config.leverage);

        const checkInterval = this.config.checkIntervalMin; // 500ms
        this.log(`✅ 启动成功，检查间隔 ${checkInterval}ms`);

        this.intervalId = setInterval(() => this.checkAndTrade(), checkInterval);
        this.checkAndTrade();
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearInterval(this.intervalId);
        // if (this.refreshIntervalId) clearInterval(this.refreshIntervalId); // 废弃旧的定时器机制
        this.log('🛑 已停止');
    }

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    log(msg) {
        if (process.stdout.isTTY) {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
        }
        console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);
    }

    logStatus(msg) {
        if (process.stdout.isTTY) {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 👁️ ${msg}`);
        }
    }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function question(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
    console.log('\n==========================================');
    console.log('       🤖 StandX Maker Bot - v11.11      ');
    console.log('       Author: 币圈毒瘤@CryptoTumor9527  ');
    console.log('==========================================\n');

    const apiToken = await question('请输入 Token: ');
    const privateKey = await question('请输入私钥: ');
    const leverage = await question('请输入杠杆倍数 (默认 10): ') || '10';
    const orderValue = await question('请输入单笔订单价值 (默认 1000): ') || '1000';
    const side = await question('请输入做单方向 (long/short/both，默认 long): ') || 'long';
    // const priceOffset = await question('请输入价格偏移比例 (默认 0.0009): ') || '0.0009'; // 已移除
    const maxDeviation = await question('请输入重挂监测阈值 (建议 0.001-0.003，默认 0.002): ') || '0.002';
    const checkMin = await question('请输入检查间隔 (毫秒，默认 500): ') || '500';
    const confirm = await question('确认启动? (y/n): ');

    if (confirm !== 'y') { rl.close(); process.exit(0); }
    rl.close();

    const bot = new StandXAPIBot({
        apiToken: apiToken.trim(),
        privateKey: privateKey.trim(),
        leverage: parseInt(leverage),
        orderValue: parseFloat(orderValue),
        side: side.trim(),
        // priceOffset: parseFloat(priceOffset), // 已移除
        maxPriceDeviation: parseFloat(maxDeviation),
        checkIntervalMin: parseInt(checkMin),
        checkIntervalMax: parseInt(checkMin)
    });

    process.on('SIGINT', () => { bot.stop(); process.exit(0); });
    bot.start();
}

main().catch(console.error);
