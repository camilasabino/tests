LoadCheckoutPaymentContext(function (Checkout, PaymentMethods) {
	var scripts = 'https://secure.mlstatic.com/sdk/javascript/v1/mercadopago.js';
	var token = null;

	var currencCreditCardBin = null;
	var currentTotalPrice = Checkout.getData().order.cart.prices.total;
	var currentIssuerId;
	var ccBrand = null;

	var getTotal = function () {
		return Checkout.getData('totalPrice') || Checkout.getData().order.cart.prices.total;
	};

	var getCardNumber = function () {
		var cardNumber = '';

		if (Checkout.getData('form').cardNumber) {
			cardNumber = Checkout.getData('form').cardNumber.split(' ').join('');
		}
		return cardNumber;
	};

	var getPaymentMethodId = function () {
		return ccBrand !== null ? ccBrand : '';
	};

	var getCardNumberBin = function () {
		return getCardNumber().substring(0, 6);
	};

	var buildInputData = function (id, value) {
		var $input = document.createElement('input');
		$input.id = id;

		if (value) {
			$input.value = value;
			$input.setAttribute('data-checkout', id);
		}

		return $input;
	};

	var generateHiddenForm = function (callback) {
		var formDataId = 'form-mercadopago-data';
		var $formData = document.getElementById(formDataId);
		var $body = document.body;

		if ($formData) {
			$body.removeChild($formData);
		}

		$formData = document.createElement('form');
		$formData.style.display = 'none';
		$formData.id = formDataId;

		callback($formData, $body)
	};

	var addCreditCardFormInputs = function ($formData, $body) {
		var cardDataExpiration = Checkout.getData('form').cardExpiration.split('/');
		var cardExpirationMonth = cardDataExpiration[0];
		var cardExpirationYear = '20' + cardDataExpiration[1];

		$formData.appendChild(buildInputData('cardNumber', getCardNumber()));
		$formData.appendChild(buildInputData('securityCode', Checkout.getData('form').cardCvv));
		$formData.appendChild(buildInputData('cardExpirationMonth', cardExpirationMonth));
		$formData.appendChild(buildInputData('cardExpirationYear', cardExpirationYear));
		$formData.appendChild(buildInputData('cardholderName', Checkout.getData('form').cardHolderName));
		$formData.appendChild(buildInputData('docType', Checkout.getData('form').cardHolderIdType || 'CPF'));
		$formData.appendChild(buildInputData('docNumber', Checkout.getData('form').cardHolderIdNumber));
		$formData.appendChild(buildInputData('paymentMethodId', getPaymentMethodId()));

		$body.appendChild($formData);
	}

	var tokenLogData = function () {
		return {
			cardNumberLength: getCardNumber().replace(/ /g, '').length,
			cardholderNameLength: Checkout.getData('form').cardHolderName && Checkout.getData('form').cardHolderName.length,
			docType: Checkout.getData('form').cardHolderIdType,
			docNumberLength: Checkout.getData('form').cardHolderIdNumber && Checkout.getData('form').cardHolderIdNumber.length,
			cardExpirationYear: Checkout.getData('form').cardExpiration && Checkout.getData('form').cardExpiration.split('/')[1]
		}
	}

	var generateCardToken = function (callback) {
		Mercadopago.createToken(
			document.getElementById('form-mercadopago-data'),
			function (status, response) {
				if (status === 200 || status === 201) {
					token = response.id;
					callback(true);
				} else {
					Checkout.Logger.error(`[CamiPay] Failed to obtain token. params: ${JSON.stringify(tokenLogData())} - response ${JSON.stringify(response)}`);
					callback(false);
				}
			}
		);
	};

	var getDocType = function () {
		const docTypeMap = new Map()
			.set('BR', 'CPF')
			.set('AR', 'DNI')
			.set('MX', 'RFC')
			.set('CH', 'CI')
			.set('CO', 'CI')
			.set('PE', 'CI');
		let docType = docTypeMap.get(Checkout.getData('country'));

		if (!docType) {
			docType = Checkout.getData('country') === 'BR' ? 'Outro' : 'Otro';
		}

		return docType;
	};

	var getTax = function (labels) {
		var label = '';
		for (var i = 0; i < labels.length; i += 1) {
			if (labels[i].indexOf('CFT_') !== -1) {
				label = labels[i];
			}
		}

		return label.split('|')[0].replace('CFT_', '');
	};

	var parceInstallments = function (installments) {
		return installments.map(function (installment) {
			return {
				quantity: installment.installments,
				installmentAmount: installment.installment_amount,
				totalAmount: installment.total_amount,
				text: installment.recommended_message,
				cft: installment.labels.length > 0 ? getTax(installment.labels) : null,
				interestFree: installment.installment_rate
			};
		});
	};

	var setInstallments = function () {
		Mercadopago.getInstallments({
			amount: getTotal(),
			bin: getCardNumberBin(),
			issuer_id: Checkout.getData('form').issuerId
		}, function (status, response) {
			if (status === 200 || status === 201) {
				var installments = parceInstallments(response[0].payer_costs)
				var filteredInstallments = [];
				var count = 0;
				var mpData = Checkout.getData('camipay_transparent_card')
				var maxInstallmentValue = mpData &&
					mpData.supportedPaymentMethods &&
					mpData.supportedPaymentMethods.credit_card &&
					mpData.supportedPaymentMethods.credit_card.min_installment_value

				maxInstallmentValue = (maxInstallmentValue && parseInt(maxInstallmentValue, 10)) || 0;

				for (count; count < installments.length; count += 1) {
					if (installments[count].installmentAmount >= maxInstallmentValue) {
						filteredInstallments.push(installments[count]);
					}
				}

				if (filteredInstallments.length === 0) {
					filteredInstallments.push(installments[0]);
				}

				Checkout.setInstallments(filteredInstallments);
			} else {
				Checkout.Logger.error('[CamiPay] Error on get installments');
			}
		});
	};

	var getResponseFromSharedBin = function (cardBin, response) {
		var toStringResp = function (resp) {
			return '{ ' +
				'id: ' + resp.id +
				', name: ' + resp.name +
				', payment_type_id: ' + resp.payment_type_id +
				', status: ' + resp.status +
				' }';
		};

		var selectedResult = function (selected, _case) {
			var logMsg = '[SharedBin][Bin ' + cardBin + '][Response ' + response.map(toStringResp) + ']' +
				'[Selected ' + toStringResp(selected) + '][Case ' + _case + ']';
			console.log('[CamiPay] ' + logMsg);
			return selected;
		};

		// filter only actives
		var activeValues = response.filter(function (res) {
			return res.status === 'active';
		}); // remove responses with "testing" status
		if (activeValues.length === 1) {
			return selectedResult(activeValues[0], 'activeValues == 1');
		}
		// filter the less generic ids
		var genericIds = ['visa', 'master']; // most generic BIN ids
		var lessGenericValues = activeValues.filter(function (value) {
			return !genericIds.includes(value.id);
		});
		if (lessGenericValues.length === 0) {
			return selectedResult(activeValues[0], 'lessGenericValues == 0');
		}
		// return the 0 indexed value even thought there might be more than one value
		return selectedResult(lessGenericValues[0], 'Success');
	};

	var setIssuerList = function () {
		Mercadopago.getIssuers(
			ccBrand,
			getCardNumberBin(),
			function (status, response) {
				if (status === 200 && response) {
					if (response[0].id !== "") {
						response.unshift({
							name: 'Elegí tu banco...',
							id: ''
						});
					}

					Checkout.updateFields({
						method: 'camipay_transparent_card',
						value: {
							issuerList: response
						}
					});
				} else {
					Checkout.Logger.error('[CamiPay] Error on get bank list');
				}
			}
		);
	};

	var setPaymentMethodId = function () {
		Mercadopago.getPaymentMethod({
			bin: getCardNumberBin()
		}, function (status, response) {
			if (status === 200) {
				try {
					// case for shared BIN
					var responseValue = (response.length > 1) ?
						getResponseFromSharedBin(getCardNumberBin(), response) :
						response[0];

					ccBrand = responseValue.id;

					var issuerMandatory = false;
					var additionalInfo = responseValue.additional_info_needed;

					for (var i = 0; i < additionalInfo.length; i += 1) {
						if (additionalInfo[i] === 'issuer_id') {
							issuerMandatory = true;
						}
					}

					if (issuerMandatory) {
						setIssuerList();
					} else {
						Checkout.updateFields({
							method: 'camipay_transparent_card',
							value: {
								issuerList: []
							}
						});
					}

					setInstallments();

				} catch (e) {
					Checkout.Logger.error(`[CamiPay] getPaymentMethod error: ${e} data: ${JSON.stringify(response)}`)
				}
			} else {
				Checkout.Logger.error(`[CamiPay] getPaymentMethod status error: ${JSON.stringify(response)}`);
			}
		});
	};

	var buildPaymentData = function () {
		var installments = Number(Checkout.getData('form').cardInstallments);
		if (!installments || installments === '') {
			installments = 1;
		}

		var data = {
			cartId: Checkout.getData().order.cart.id || null,
			cartHash: Checkout.getData().order.cart.hash || null,
			cc_token: token || null,
			payment_method: 'credit_card',
			brand: ccBrand || null,
			installments: installments,
			billing_id_type: Checkout.getData('form').cardHolderIdType || 'CPF',
			card_holder_id_number: Checkout.getData('form').cardHolderIdNumber || null,
			issuer_id: Checkout.getData('form').issuerId || null,
			sender_hash: null
		};

		Checkout.Logger.info('CamiPay transparent info', data);
		return data;
	};

	var refreshInstallments = function () {
		var creditCardBin = getCardNumberBin();

		var hasCreditCardBin = creditCardBin && creditCardBin.length >= 6;
		var hasPrice = Boolean(Checkout.getData('totalPrice'));
		var changedCreditCardBin = creditCardBin !== currencCreditCardBin;
		var changedPrice = Checkout.getData('totalPrice') !== currentTotalPrice;

		return (hasCreditCardBin && hasPrice) && (changedCreditCardBin || changedPrice);
	};

	var processPayment = function (url, params, callback, paymentType) {
		Checkout.http.post(url, params).then(function (response) {
			var deprecatedSuccessResponse = (response.data && response.data.status !== 'error');
			var successResponse = (response.data && response.data.status !== 'failure');
			var success = response.status === 200 && (deprecatedSuccessResponse && successResponse);

			var responseMsg = response.data.msg || response.data.response_message;
			var redirect = response.data.action;
			var extraAuthorized = paymentType === 'redirect' ? success : false;
			var close = paymentType === 'redirect' ? false : success;
			var errorCode = response.data && response.data.error_code;

			if (!success) {
				Mercadopago.clearSession();
			}

			if (response.data && response.data.inputs) {
				var inputs = response.data.inputs;
				var prefId = inputs.pref_id || inputs['pref-id'] || inputs['preference-id'];
				if (prefId) {
					redirect += '?pref_id=' + prefId;
				}
			}

			callback({
				success: success,
				extraAuthorized: extraAuthorized,
				redirect: redirect,
				close: close,
				confirmed: close,
				message: responseMsg,
				error_code: errorCode
			});
		}).catch(function (error) {
			Checkout.Logger.error(`[CamiPay] processPayment error ${error.message}`);
			Mercadopago.clearSession();
			callback({
				success: false,
				error: error
			});
		});
	};

	var External = PaymentMethods.ExternalPayment({
		id: 'camipay_redirect',
		name: 'camipayRedirect',
		scripts: 'https://www.mercadopago.com/org-img/jsapi/mptools/buttons/render.js',
		onSubmit: function (callback) {
			processPayment(
				'/checkout/v3/checkout_external/mercadopago', {
					type: 'form'
				},
				callback,
				'redirect'
			)
		}
	});

	var ExternalPix = PaymentMethods.ExternalPayment({
		id: 'camipay_redirect_pix',
		name: 'camipayRedirectPix',
		scripts: 'https://www.mercadopago.com/org-img/jsapi/mptools/buttons/render.js',
		onSubmit: function (callback) {
			processPayment(
				'/checkout/v3/checkout_external/mercadopago', {
					type: 'form',
					mercadopagoPix: true
				},
				callback,
				'redirect'
			)
		}
	});

	var getCustomLabel = function () {
		return Checkout.getData('country') === 'AR' ? 'Rapipago o Pago fácil' : null
	}

	var MercadopagoOffline = PaymentMethods.Transparent.OfflinePayment({
		id: 'camipay_transparent_offline',
		name: 'camipayTransparentOffline',
		customLabel: getCustomLabel(),
		scripts: scripts,
		fields: {
			billing_address: true
		},
		onLoad: function () {
			Mercadopago.setPublishableKey(Checkout.getData('camipay_transparent_offline').public_key);
		},

		onSubmit: function (callback) {
			processPayment(
				'/checkout/v3/checkout_transparent/mercadopago', {
					cartId: Checkout.getData().order.cart.id || null,
					cartHash: Checkout.getData().order.cart.hash || null,
					payment_method: 'offline',
					brand: Checkout.getData('form').brand || 'bolbradesco',
					billing_id_type: getDocType(),
					boleto_name: Checkout.getData('form').holderName,
					card_holder_id_number: Checkout.getData('form').holderIdNumber
				},
				callback,
				'offline'
			)
		}
	});

	var MercadopagoCredit = PaymentMethods.Transparent.CardPayment({
		id: 'camipay_transparent_card',
		name: 'camipayTransparentCard',
		scripts: scripts,
		fields: {
			billing_address: true
		},
		onDataChange: Checkout.utils.throttle(function () {
			var creditCardBin = getCardNumberBin();
			var issuerId = Checkout.getData('form').issuerId;
			if (refreshInstallments()) {
				setPaymentMethodId();
				currencCreditCardBin = creditCardBin;
				currentTotalPrice = Checkout.getData('totalPrice');
			} else if (issuerId && issuerId !== currentIssuerId) {
				setInstallments();
				currentIssuerId = Checkout.getData('form').issuerId;
			} else if (!creditCardBin) {
				Checkout.setInstallments(null);
				currencCreditCardBin = null;
				ccBrand = null;
			}

			return true;
		}, 700),

		onLoad: function () {
			Mercadopago.setPublishableKey(Checkout.getData('camipay_transparent_card').public_key);
		},

		onSubmit: function (callback) {
			generateHiddenForm(addCreditCardFormInputs);
			generateCardToken(function (cardTokenSuccess) {
				if (!cardTokenSuccess) {
					return callback({
						success: false,
						close: false,
						confirmed: false
					});
				}

				processPayment(
					'/checkout/v3/checkout_transparent/mercadopago',
					buildPaymentData(),
					callback,
					'credit'
				)
			});
		}
	});

	Checkout.addPaymentOption(External);
	Checkout.addPaymentOption(MercadopagoOffline);
	Checkout.addPaymentOption(MercadopagoCredit);
	Checkout.addPaymentOption(ExternalPix)
});
