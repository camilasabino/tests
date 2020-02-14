LoadPaymentMethod(function (Checkout, Methods) {
  var Redirect = new Methods.RedirectPayment({
    name: 'CamiPay',
    onSubmit: function (callback) {
      console.log("Create transaction via Postman now.")
      window.callMe = function(){
        callback({
          success: true
        });
      }
    }
  });
  Checkout.addMethod(Redirect);
});
