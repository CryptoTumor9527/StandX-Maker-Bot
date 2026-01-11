// ==UserScript==
// @name         StandX Maker Bot (API Version)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  StandX 自动做市机器人 - API + Ed25519签名 + 安全机制
// @author       You
// @match        https://standx.com/perps*
// @grant        GM_xmlhttpRequest
// @connect      perps.standx.com
// ==/UserScript==

(function () {
    'use strict';

    class StandXAPIBot {
        constructor(config) {
            this.config = {
                baseURL: 'https://perps.standx.com',
                apiToken: config.apiToken,
                leverage: config.leverage || 5,
                priceOffset: config.priceOffset || 0.002,  // 0.2% 匹配 v5.0
                orderValue: config.orderValue || 2000,  // 订单价值 DUSD,默认 2000
                side: config.side || 'long',  // 默认只做多,匹配 v5.0
                autoClosePosition: config.autoClosePosition !== false,
                checkIntervalMin: config.checkIntervalMin || 500,   // 0.5秒 - 更快的检测
                checkIntervalMax: config.checkIntervalMax || 500,   // 0.5秒 - 更快的检测
                refreshIntervalMin: config.refreshIntervalMin || 120000,
                refreshIntervalMax: config.refreshIntervalMax || 180000,
                maxPriceDeviation: config.maxPriceDeviation || 0.003,  // 0.3% 匹配 v5.0
                safetyThreshold: config.safetyThreshold || 0.0005  // 0.05% 安全阈值
            };

            this.isRunning = false;
            this.lastPrice = null;
            this.intervalId = null;
            this.refreshIntervalId = null;
            this.leverageSet = false;
            this.lastRefreshTime = Date.now();
            this.cryptoKey = null; // Ed25519 私钥
            this.debugMode = false; // 调试模式开关
            this.activeOrders = []; // 跟踪活跃订单
        }

        // ==================== 签名方法 ====================

        async getCryptoKey() {
            if (this.cryptoKey) {
                return this.cryptoKey;
            }

            return new Promise((resolve, reject) => {
                const dbRequest = indexedDB.open('standx_auth', 1);

                dbRequest.onsuccess = (event) => {
                    const db = event.target.result;
                    const transaction = db.transaction('keys', 'readonly');
                    const store = transaction.objectStore('keys');
                    const getAllRequest = store.getAll();

                    getAllRequest.onsuccess = () => {
                        const data = getAllRequest.result[0];
                        if (data && data.privateKey) {
                            this.cryptoKey = data.privateKey;
                            resolve(data.privateKey);
                        } else {
                            reject(new Error('未找到签名密钥'));
                        }
                    };

                    getAllRequest.onerror = () => {
                        reject(new Error('读取密钥失败'));
                    };
                };

                dbRequest.onerror = () => {
                    reject(new Error('打开数据库失败'));
                };
            });
        }

        async signRequest(payload) {
            try {
                const privateKey = await this.getCryptoKey();
                const requestId = this.generateUUID();
                const timestamp = Date.now();
                const version = 'v1';

                // 构建签名消息: {version},{id},{timestamp},{payload}
                const message = `${version},${requestId},${timestamp},${payload}`;
                const encoder = new TextEncoder();
                const messageBytes = encoder.encode(message);

                // 使用 Ed25519 签名
                const signature = await crypto.subtle.sign(
                    'Ed25519',
                    privateKey,
                    messageBytes
                );

                // 转换为 Base64
                const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

                return {
                    'x-request-sign-version': version,
                    'x-request-id': requestId,
                    'x-request-timestamp': timestamp.toString(),
                    'x-request-signature': signatureBase64
                };
            } catch (error) {
                this.log(`❌ 签名失败: ${error.message}`);
                throw error;
            }
        }

        generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        // ==================== API 方法 ====================

        async apiRequest(method, endpoint, data = null) {
            const url = `${this.config.baseURL}${endpoint}`;
            const headers = {
                'Authorization': `Bearer ${this.config.apiToken}`,
                'Content-Type': 'application/json'
            };

            // 只在调试模式显示 API 请求详情
            if (this.debugMode) {
                this.log(`🔍 API 请求: ${method} ${endpoint}`);
                this.log(`   Token (前50字符): ${this.config.apiToken.substring(0, 50)}...`);
            }

            // 对于 POST 请求,添加签名
            if (method === 'POST' && data) {
                try {
                    const payload = JSON.stringify(data);
                    const signatureHeaders = await this.signRequest(payload);
                    Object.assign(headers, signatureHeaders);
                    if (this.debugMode) {
                        this.log(`   ✅ 已添加签名头`);
                    }
                } catch (error) {
                    this.log(`   ⚠️ 签名失败,尝试不带签名请求: ${error.message}`);
                }
            }

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    headers: headers,
                    data: data ? JSON.stringify(data) : null,
                    onload: (response) => {
                        try {
                            // 检查响应状态
                            if (response.status !== 200) {
                                reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                                return;
                            }

                            // 检查响应内容
                            const responseText = response.responseText;
                            if (!responseText || responseText.trim() === '') {
                                reject(new Error('空响应'));
                                return;
                            }

                            // 尝试解析 JSON
                            const result = JSON.parse(responseText);
                            resolve(result);
                        } catch (error) {
                            if (this.debugMode) {
                                this.log(`❌ API 响应解析失败: ${error.message}`);
                                this.log(`   URL: ${url}`);
                                this.log(`   状态: ${response.status}`);
                                this.log(`   响应: ${response.responseText?.substring(0, 200)}`);
                            }
                            reject(new Error('解析响应失败: ' + error.message));
                        }
                    },
                    onerror: (error) => {
                        if (this.debugMode) {
                            this.log(`❌ API 请求失败: ${url}`);
                        }
                        reject(new Error('API 请求失败: ' + error));
                    },
                    ontimeout: () => {
                        if (this.debugMode) {
                            this.log(`❌ API 请求超时: ${url}`);
                        }
                        reject(new Error('请求超时'));
                    },
                    timeout: 10000
                });
            });
        }

        async getCurrentPrice() {
            try {
                const result = await this.apiRequest('GET', '/api/query_symbol_price?symbol=BTC-USD');

                // API 返回: last_price, mid_price, mark_price, index_price
                // 优先使用 last_price, 如果为 null 则使用 mid_price
                let price = null;
                if (result) {
                    price = result.last_price || result.mid_price || result.mark_price;
                }

                if (price) {
                    const priceNum = parseFloat(price);
                    this.log(`📊 当前价格: $${priceNum.toFixed(2)}`);
                    return priceNum;
                }

                throw new Error('无法获取价格');
            } catch (error) {
                this.log('❌ 获取价格失败: ' + error.message);
                return null;
            }
        }

        async getCurrentPosition() {
            try {
                const result = await this.apiRequest('GET', '/api/query_positions?symbol=BTC-USD');

                if (result && Array.isArray(result) && result.length > 0) {
                    const position = result[0];
                    const qtyStr = position.qty || '0';
                    const qty = parseFloat(qtyStr);

                    // API 不返回 side 字段,通过 qty 的正负判断方向
                    // 正数 = LONG (做多), 负数 = SHORT (做空)
                    const side = qty > 0 ? 'long' : (qty < 0 ? 'short' : 'none');
                    const absQty = Math.abs(qty);

                    if (absQty > 0) {
                        this.log(`📊 检测到持仓: ${absQty} BTC (${side.toUpperCase()})`);
                        return { qty: absQty, side: side, rawQty: qty };
                    }
                }

                return null;
            } catch (error) {
                if (this.debugMode) {
                    this.log('❌ 获取持仓失败: ' + error.message);
                }
                return null;
            }
        }

        async hasActiveOrders() {
            try {
                const response = await this.apiRequest('GET', '/api/query_orders?symbol=BTC-USD&status=open');

                // API 返回: { page_size, result: [...], total }
                const orders = response?.result || [];

                if (Array.isArray(orders)) {
                    const activeOrders = orders.filter(order =>
                        order.status === 'open' || order.status === 'partially_filled'
                    );

                    // 保存活跃订单详情用于安全检查
                    this.activeOrders = activeOrders.map(order => ({
                        id: order.id,
                        price: parseFloat(order.price),
                        side: order.side,
                        qty: order.qty
                    }));

                    if (activeOrders.length > 0) {
                        this.log(`🔍 检测到 ${activeOrders.length} 个活跃订单`);
                    }
                    return activeOrders.length > 0;
                }

                this.activeOrders = [];
                return false;
            } catch (error) {
                if (this.debugMode) {
                    this.log('❌ 检测订单失败: ' + error.message);
                }
                this.activeOrders = [];
                return false;
            }
        }

        async checkOrderSafety(currentPrice) {
            if (!currentPrice || this.activeOrders.length === 0) {
                return false;
            }

            let canceledAny = false;

            for (const order of this.activeOrders) {
                const orderPrice = order.price;
                const priceDiff = Math.abs(currentPrice - orderPrice);
                const deviation = priceDiff / orderPrice;

                // 如果价格接近订单价格小于安全阈值,取消订单
                if (deviation < this.config.safetyThreshold) {
                    const deviationPercent = (deviation * 100).toFixed(3);
                    this.log(`⚠️ 价格过于接近订单! 当前: $${currentPrice.toFixed(2)}, 订单: $${orderPrice.toFixed(2)} (偏离: ${deviationPercent}%)`);
                    this.log(`🛡️ 触发安全机制,取消订单 #${order.id}`);

                    try {
                        await this.apiRequest('POST', '/api/cancel_order', {
                            order_id: order.id
                        });
                        this.log(`✅ 订单 #${order.id} 已安全取消`);
                        canceledAny = true;
                    } catch (error) {
                        this.log(`❌ 取消订单失败: ${error.message}`);
                    }
                }
            }

            // 如果取消了订单,清空 lastPrice 以便重新下单
            if (canceledAny) {
                this.lastPrice = null;
                this.activeOrders = [];
            }

            return canceledAny;
        }

        async setLeverage(leverage) {
            try {
                this.log(`⚙️ 设置杠杆: ${leverage}x`);

                const result = await this.apiRequest('POST', '/api/change_leverage', {
                    symbol: 'BTC-USD',
                    leverage: leverage
                });

                this.log(`✅ 杠杆已设置为 ${leverage}x`);
                return true;
            } catch (error) {
                this.log('❌ 设置杠杆失败: ' + error.message);
                return false;
            }
        }

        calculateOptimalPrice(currentPrice, side) {
            const offset = currentPrice * this.config.priceOffset;
            return side === 'long'
                ? currentPrice - offset
                : currentPrice + offset;
        }

        async placeOrder(side, price, orderValue) {
            try {
                // 根据订单价值和价格计算 BTC 数量
                // orderValue (DUSD) / price (USD/BTC) = quantity (BTC)
                const quantity = (orderValue / price).toFixed(4);

                const currentPrice = this.lastPrice || price;
                const deviation = ((price - currentPrice) / currentPrice * 100).toFixed(2);
                const deviationSign = deviation > 0 ? '+' : '';
                this.log(`📝 下单: ${side.toUpperCase()} ${quantity} BTC (价值: $${orderValue}) @ $${price.toFixed(2)} (偏差: ${deviationSign}${deviation}%)`);

                const result = await this.apiRequest('POST', '/api/new_order', {
                    symbol: 'BTC-USD',
                    side: side === 'long' ? 'buy' : 'sell',
                    order_type: 'limit',
                    qty: quantity,
                    price: price.toFixed(2),
                    time_in_force: 'gtc',
                    reduce_only: false
                });

                this.log(`✅ 订单已提交`);
                return true;
            } catch (error) {
                this.log('❌ 下单失败: ' + error.message);
                return false;
            }
        }

        async cancelAllOrders() {
            try {
                this.log('🗑️ 取消所有订单...');

                // 先查询所有订单
                const response = await this.apiRequest('GET', '/api/query_orders?symbol=BTC-USD&status=open');

                // API 返回: { page_size, result: [...], total }
                const orders = response?.result || [];

                if (!orders || orders.length === 0) {
                    if (this.debugMode) {
                        this.log('  ℹ️ 没有需要取消的订单');
                    }
                    return true;
                }

                const orderIds = orders.map(order => order.id);

                const result = await this.apiRequest('POST', '/api/cancel_orders', {
                    order_id_list: orderIds
                });

                this.log(`✅ 已取消 ${orderIds.length} 个订单`);
                return true;
            } catch (error) {
                this.log('❌ 取消订单失败: ' + error.message);
                return false;
            }
        }

        async closePosition(position) {
            try {
                this.log(`🔴 开始平仓: ${position.qty} BTC (${position.side.toUpperCase()})`);

                // 先取消所有订单
                await this.cancelAllOrders();
                await this.sleep(500);

                // 平仓方向与持仓方向相反
                // LONG 持仓 -> SELL 平仓
                // SHORT 持仓 -> BUY 平仓
                const closeSide = position.side.toLowerCase() === 'long' ? 'sell' : 'buy';
                const closeQty = position.qty.toString();

                // 获取当前价格
                const currentPrice = await this.getCurrentPrice();
                if (!currentPrice) {
                    throw new Error('无法获取当前价格');
                }

                // 使用攻击性价格确保成交
                // SELL: 使用低于市价 3% 的价格
                // BUY: 使用高于市价 3% 的价格
                const closePrice = closeSide === 'sell'
                    ? (currentPrice * 0.97).toFixed(2)
                    : (currentPrice * 1.03).toFixed(2);

                this.log(`📝 平仓订单: ${closeSide.toUpperCase()} ${closeQty} BTC @ $${closePrice}`);

                const result = await this.apiRequest('POST', '/api/new_order', {
                    symbol: 'BTC-USD',
                    side: closeSide,
                    order_type: 'limit',
                    qty: closeQty,
                    price: closePrice,
                    time_in_force: 'ioc',  // 立即成交或取消
                    reduce_only: true  // 只减仓
                });

                this.log('✅ 平仓订单已提交');

                // 等待成交
                await this.sleep(3000);

                // 验证平仓结果
                const newPosition = await this.getCurrentPosition();
                if (!newPosition || newPosition.qty === 0) {
                    this.log('✅ 平仓成功!');
                    return true;
                } else {
                    this.log(`⚠️ 平仓未完全成功,剩余: ${newPosition.qty} BTC`);

                    // 如果还有剩余,尝试第二次平仓
                    this.log('🔄 尝试第二次平仓...');
                    const secondClosePrice = closeSide === 'sell'
                        ? (currentPrice * 0.95).toFixed(2)  // 更攻击性的价格
                        : (currentPrice * 1.05).toFixed(2);

                    await this.apiRequest('POST', '/api/new_order', {
                        symbol: 'BTC-USD',
                        side: closeSide,
                        order_type: 'limit',
                        qty: newPosition.qty.toString(),
                        price: secondClosePrice,
                        time_in_force: 'ioc',
                        reduce_only: true
                    });

                    await this.sleep(2000);
                    const finalPosition = await this.getCurrentPosition();

                    if (!finalPosition || finalPosition.qty === 0) {
                        this.log('✅ 第二次平仓成功!');
                        return true;
                    } else {
                        this.log(`❌ 平仓仍未完成,剩余: ${finalPosition.qty} BTC`);
                        return false;
                    }
                }
            } catch (error) {
                this.log('❌ 平仓失败: ' + error.message);
                return false;
            }
        }

        async checkInitialPosition() {
            this.log('🔍 检查初始持仓...');
            const position = await this.getCurrentPosition();

            if (position && position.qty !== 0) {
                this.log(`⚠️ 检测到现有持仓: ${position.qty} BTC (${position.side})`);

                if (this.config.autoClosePosition) {
                    this.log('🔄 自动平仓模式已启用,将尝试平仓...');
                    const closed = await this.closePosition(position);
                    if (closed) {
                        this.log('✅ 初始持仓已平仓,继续启动...');
                        return true;
                    } else {
                        this.log('❌ 平仓失败,停止启动');
                        return false;
                    }
                } else {
                    this.log('❌ 存在持仓且未启用自动平仓,停止启动');
                    return false;
                }
            }

            this.log('✅ 无初始持仓,继续启动...');
            return true;
        }

        async mainLoop() {
            if (!this.isRunning) return; // 立即检查运行状态

            try {
                const position = await this.getCurrentPosition();

                if (position && position.qty !== 0) {
                    this.log(`⚠️ 检测到持仓,立即平仓!`);

                    const closed = await this.closePosition(position);

                    if (!closed) {
                        this.log('❌ 平仓失败,停止交易');
                        this.stop();
                        return;
                    }

                    this.log('✅ 平仓成功,继续监控...');
                    return;
                }

                const hasOrders = await this.hasActiveOrders();
                const currentPrice = await this.getCurrentPrice();

                if (!currentPrice) {
                    this.log('❌ 无法获取价格,跳过本次循环');
                    return;
                }

                // 安全检查: 如果价格过于接近订单,取消订单
                const canceled = await this.checkOrderSafety(currentPrice);
                if (canceled) {
                    this.log('🔄 订单已被安全取消,等待重新下单...');
                    return;
                }

                const shouldRefreshOrders = !this.lastPrice ||
                    Math.abs(currentPrice - this.lastPrice) / this.lastPrice > this.config.maxPriceDeviation;

                if (!hasOrders || shouldRefreshOrders) {
                    if (shouldRefreshOrders && this.lastPrice) {
                        const deviation = ((currentPrice - this.lastPrice) / this.lastPrice * 100).toFixed(2);
                        this.log(`⚠️ 价格偏离 ${deviation}%,需要刷新订单`);
                    } else {
                        this.log('📝 无活跃订单,准备下单...');
                    }

                    this.log('🔄 取消旧订单...');
                    await this.cancelAllOrders();
                    await this.sleep(1000);

                    let sidesToPlace = [];
                    if (this.config.side === 'random') {
                        const randomSide = Math.random() < 0.5 ? 'long' : 'short';
                        sidesToPlace = [randomSide];
                        this.log(`🎲 随机选择方向: ${randomSide.toUpperCase()}`);
                    } else if (this.config.side === 'both') {
                        sidesToPlace = ['long', 'short'];
                    } else {
                        sidesToPlace = [this.config.side];
                    }

                    for (const side of sidesToPlace) {
                        const price = this.calculateOptimalPrice(currentPrice, side);
                        await this.placeOrder(side, price, this.config.orderValue);

                        if (sidesToPlace.length > 1) {
                            await this.sleep(500);
                        }
                    }

                    await this.sleep(2000);
                    this.lastPrice = currentPrice;
                    this.log(`✅ 订单已提交,价格已记录: $${currentPrice.toFixed(2)}`);
                } else {
                    // 显示当前价格与挂单价格的偏离
                    if (this.lastPrice) {
                        const deviation = ((currentPrice - this.lastPrice) / this.lastPrice * 100).toFixed(2);
                        const deviationSign = deviation > 0 ? '+' : '';
                        this.log(`✅ 订单位置良好 (偏离: ${deviationSign}${deviation}%)`);
                    } else {
                        this.log('✅ 订单位置良好,无需调整');
                    }
                }

            } catch (error) {
                this.log('❌ 主循环错误: ' + error.message);
            }
        }

        async start() {
            if (this.isRunning) {
                this.log('⚠️ 机器人已在运行中');
                return;
            }

            this.isRunning = true;

            try {
                this.log('');
                this.log('═'.repeat(60));
                this.log('🚀 启动 StandX Maker Bot v9.0 (API + Ed25519 + 安全机制)...');
                this.log('═'.repeat(60));

                const canStart = await this.checkInitialPosition();
                if (!canStart) {
                    this.isRunning = false;
                    return;
                }

                if (!this.leverageSet) {
                    await this.setLeverage(this.config.leverage);
                    this.leverageSet = true;
                }

                const scheduleNext = async () => {
                    if (!this.isRunning) return; // 检查运行状态

                    await this.mainLoop();

                    if (!this.isRunning) return; // 再次检查运行状态

                    const randomInterval = Math.floor(
                        Math.random() * (this.config.checkIntervalMax - this.config.checkIntervalMin + 1)
                    ) + this.config.checkIntervalMin;

                    this.intervalId = setTimeout(scheduleNext, randomInterval);
                };

                const scheduleRefresh = () => {
                    if (!this.isRunning) return; // 检查运行状态

                    if (this.refreshIntervalId) {
                        clearTimeout(this.refreshIntervalId);
                    }

                    const randomRefreshInterval = Math.floor(
                        Math.random() * (this.config.refreshIntervalMax - this.config.refreshIntervalMin + 1)
                    ) + this.config.refreshIntervalMin;

                    this.refreshIntervalId = setTimeout(async () => {
                        if (!this.isRunning) return; // 检查运行状态

                        this.log('\n🔄 定期刷新订单...');
                        this.lastPrice = null;
                        scheduleRefresh();
                    }, randomRefreshInterval);

                    this.log(`⏰ 下次订单刷新: ${(randomRefreshInterval / 1000).toFixed(0)} 秒后`);
                };

                scheduleRefresh();

                this.log(`✅ 机器人已启动,随机间隔 ${this.config.checkIntervalMin / 1000}-${this.config.checkIntervalMax / 1000} 秒检查一次`);
                this.log(`🔄 订单刷新间隔: ${this.config.refreshIntervalMin / 1000}-${this.config.refreshIntervalMax / 1000} 秒`);
                this.log('💡 点击停止按钮可停止机器人');
                this.log('');

                scheduleNext();
            } catch (error) {
                this.log('❌ 启动失败: ' + error.message);
                this.isRunning = false;
            }
        }

        stop() {
            if (!this.isRunning) {
                this.log('⚠️ 机器人未在运行');
                return;
            }

            this.isRunning = false;

            if (this.intervalId) {
                clearTimeout(this.intervalId);
                this.intervalId = null;
            }

            if (this.refreshIntervalId) {
                clearTimeout(this.refreshIntervalId);
                this.refreshIntervalId = null;
            }

            this.log('');
            this.log('═'.repeat(60));
            this.log('🛑 机器人已停止');
            this.log('═'.repeat(60));
            this.log('');
        }

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        log(message) {
            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            const logMessage = `[${timestamp}] ${message}`;
            console.log(logMessage);

            // 添加到 UI 日志
            const logContainer = document.getElementById('bot-log-content');
            if (logContainer) {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = logMessage;

                // 根据消息内容添加颜色
                if (message.includes('❌') || message.includes('失败')) {
                    logEntry.style.color = '#ff6b6b';
                } else if (message.includes('✅') || message.includes('成功')) {
                    logEntry.style.color = '#51cf66';
                } else if (message.includes('⚠️') || message.includes('警告')) {
                    logEntry.style.color = '#ffd43b';
                } else if (message.includes('🚀') || message.includes('═')) {
                    logEntry.style.color = '#4dabf7';
                    logEntry.style.fontWeight = 'bold';
                }

                logContainer.appendChild(logEntry);

                // 限制日志条数
                while (logContainer.children.length > 100) {
                    logContainer.removeChild(logContainer.firstChild);
                }

                // 自动滚动到底部
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        }
    }

    // 创建 UI
    function createUI() {
        const container = document.createElement('div');
        container.id = 'standx-bot-container';
        container.innerHTML = `
            <style>
                #standx-bot-container {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 400px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                    z-index: 10000;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: white;
                    cursor: move;
                    user-select: none;
                }
                
                #standx-bot-container h3 {
                    margin: 0 0 15px 0;
                    font-size: 18px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                }
                
                .badge {
                    background: rgba(255,255,255,0.3);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 12px;
                }
                
                .author-info {
                    text-align: right;
                    font-size: 11px;
                    line-height: 1.4;
                    opacity: 0.9;
                }
                
                .author-info a {
                    color: white;
                    text-decoration: none;
                    transition: opacity 0.3s;
                }
                
                .author-info a:hover {
                    opacity: 0.7;
                    text-decoration: underline;
                }
                
                .bot-control {
                    margin-bottom: 10px;
                }
                
                .bot-control label {
                    display: block;
                    margin-bottom: 5px;
                    font-size: 13px;
                    opacity: 0.9;
                }
                
                .bot-control input, .bot-control select {
                    width: 100%;
                    padding: 8px;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    box-sizing: border-box;
                    color: #2d3748;  /* 深灰色文字 */
                    background: white;
                }
                
                .bot-control input[type="number"] {
                    width: 100%;
                }
                
                .button-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 15px;
                }
                
                button {
                    flex: 1;
                    padding: 10px;
                    border: none;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                }
                
                #start-btn {
                    background: #51cf66;
                    color: white;
                }
                
                #start-btn:hover {
                    background: #40c057;
                    transform: translateY(-2px);
                }
                
                #stop-btn {
                    background: #ff6b6b;
                    color: white;
                }
                
                #stop-btn:hover {
                    background: #fa5252;
                    transform: translateY(-2px);
                }
                
                #bot-log-panel {
                    margin-top: 15px;
                    background: rgba(0,0,0,0.3);
                    border-radius: 8px;
                    padding: 10px;
                }
                
                #bot-log-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(255,255,255,0.2);
                }
                
                #bot-log-header h4 {
                    margin: 0;
                    font-size: 14px;
                }
                
                #clear-log-btn {
                    background: rgba(255,255,255,0.2);
                    color: white;
                    border: none;
                    padding: 4px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background 0.3s;
                }
                
                #clear-log-btn:hover {
                    background: rgba(255,255,255,0.3);
                }
                
                #bot-log-content {
                    height: 300px;
                    overflow-y: auto;
                    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
                    font-size: 11px;
                    line-height: 1.5;
                    background: rgba(0,0,0,0.2);
                    padding: 8px;
                    border-radius: 4px;
                }
                
                #bot-log-content::-webkit-scrollbar {
                    width: 6px;
                }
                
                #bot-log-content::-webkit-scrollbar-track {
                    background: rgba(0,0,0,0.1);
                    border-radius: 3px;
                }
                
                #bot-log-content::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.3);
                    border-radius: 3px;
                }
                
                #bot-log-content::-webkit-scrollbar-thumb:hover {
                    background: rgba(255,255,255,0.5);
                }
                
                .log-entry {
                    margin-bottom: 2px;
                    word-wrap: break-word;
                }
            </style>
            <h3>
                <span>🤖 StandX API Bot <span class="badge">v9.0</span></span>
                <div class="author-info">
                    <a href="https://x.com/CryptoTumor9527" target="_blank" rel="noopener noreferrer">
                        Created by 币圈毒瘤<br>
                        @CryptoTumor9527<br>
                        义父们妈妈们求个关注🙏
                    </a>
                </div>
            </h3>
            
            <div class="bot-control">
                <label>API Token:</label>
                <input type="password" id="api-token-input" placeholder="输入你的 API Token">
            </div>
            
            <div class="bot-control">
                <label>杠杆:</label>
                <select id="leverage-select">
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                    <option value="5" selected>5x</option>
                    <option value="10">10x</option>
                    <option value="20">20x</option>
                    <option value="40">40x</option>
                </select>
            </div>
            
            <div class="bot-control">
                <label>订单价值 (DUSD):</label>
                <input type="number" id="value-input" value="2000" min="100" max="100000" step="100" placeholder="例如: 2000">
            </div>
            
            <div class="bot-control">
                <label>订单方向:</label>
                <select id="side-select">
                    <option value="long" selected>仅 LONG</option>
                    <option value="both">双向 (LONG + SHORT)</option>
                    <option value="short">仅 SHORT</option>
                    <option value="random">随机</option>
                </select>
            </div>
            
            <div class="button-group">
                <button id="start-btn">启动</button>
                <button id="stop-btn">停止</button>
            </div>
            
            <div id="bot-log-panel">
                <div id="bot-log-header">
                    <h4>📊 运行日志</h4>
                    <button id="clear-log-btn">清空</button>
                </div>
                <div id="bot-log-content"></div>
            </div>
        `;

        document.body.appendChild(container);

        // 实现拖动功能
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        const header = container.querySelector('h3');

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;

            if (e.target === header || e.target.parentElement === header) {
                isDragging = true;
            }
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, container);
            }
        }

        function dragEnd(e) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }

        // 绑定按钮事件
        let botInstance = null;

        document.getElementById('start-btn').addEventListener('click', () => {
            console.log('🔍 启动按钮被点击');

            const token = document.getElementById('api-token-input').value.trim();
            const leverage = parseInt(document.getElementById('leverage-select').value);
            const orderValue = document.getElementById('value-input').value.trim();
            const side = document.getElementById('side-select').value;

            console.log('📋 配置参数:', { token: token ? '已设置' : '未设置', leverage, orderValue, side });

            if (!token) {
                alert('请输入 API Token');
                return;
            }

            if (!orderValue || parseFloat(orderValue) <= 0) {
                alert('请输入有效的订单价值');
                return;
            }

            if (botInstance) {
                console.log('🛑 停止现有实例');
                botInstance.stop();
            }

            console.log('🚀 创建新的机器人实例');
            botInstance = new StandXAPIBot({
                apiToken: token,
                leverage: leverage,
                orderValue: parseFloat(orderValue),
                side: side
            });

            console.log('▶️ 启动机器人');
            botInstance.start();
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            if (botInstance) {
                botInstance.stop();
            }
        });

        document.getElementById('clear-log-btn').addEventListener('click', () => {
            const logContent = document.getElementById('bot-log-content');
            if (logContent) {
                logContent.innerHTML = '';
            }
        });
    }

    // 页面加载完成后创建 UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

})();
