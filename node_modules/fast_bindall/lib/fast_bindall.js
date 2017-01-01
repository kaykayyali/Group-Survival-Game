(function() {
	var Fast_Bindall = function() {
		var bind_it = function(key, func, context) {
			context[key] = function() {
				return func.apply(context, arguments);
			};
		};
		if (arguments.length === 0) {
			throw new Error("Must supply at least a context to Fast_Bindall");
		}
		var context = arguments[0];
		if (arguments.length === 2) { // only do some functions
			var len = arguments[1].length;
			while(arguments[1][--len]) {
				var function_name = arguments[1][len];
				if (typeof context[function_name] === 'function') {
					var to_call = context[function_name];
					context[function_name] = function() { 
						return to_call.apply(context, arguments); 
					};
				}
			}
		}
		else {
			for(var i in context) {
				if (typeof context[i] === 'function') {
					var to_call = context[i];
					var key = i;
					bind_it(i, to_call, context);
				}
			}
		}
	};

	if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
		module.exports = Fast_Bindall;
	}
	else {
		window.Fast_Bindall = Fast_Bindall;
	}
})();
