exports.handler = async (event) => {

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Backend is working"
    }),
  };

};